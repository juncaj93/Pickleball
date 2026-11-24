# Pickleball design notes

The look follows Apple's own iPhone apps: calm gray background, white cards,
clear type, quick to scan. All of it lives in `src/styles.css`, tokens first.

## Rules

- **One green button per card at most.** Green is the accent for the main
  action (I'm in, Pay, Yes, we played). Everything else is soft
  gray or outlined. The browser tests count this on every screen.
- **Status colors keep their meaning.** Green: court booked. Amber: court
  not booked. Gray: booking not open yet. Red: cancel only. Zip 86: no court
  Waitlist anywhere (Alex, round 2). On the organizer's Home card the status
  button carries the color (solid green Booked with a ball-yellow dot, amber
  Not booked); the card itself is one floating frame (1 px line, soft
  shadow), no stripe, In or Out.
- **Date tiles** look like a paper calendar: white with a thin outline, the
  weekday in red, the big day number dark, the month small and gray. Dark
  mode: dark tile, light outline, a softer red. The header's today square
  matches. A small green check on the tile's corner means you're in.
- **Later weeks fade gently.** This week and next week are full strength.
  Each week after that gets a lighter tile outline, softer grays and calmer
  text (`data-fade` 1 to 3 on the card, set by `weekFade`). Only colors
  change, never opacity, and every word stays at 4.5:1 or better. Buttons and
  the court status keep their colors.
- **Session cards stay calm.** The player card is at most four rows: time
  (with the button beside rows 1 and 2), court status with any holiday as
  small colored words, then "2 of 4 in" with a dot per spot and the names as
  one line of plain text ("+2" when long), then, only when needed, Pay with a
  small calendar icon. No pills or name chips. Organizer cards use the same
  dots and names, with the organizer's own I'm in at the right end of that
  row. Add to calendar lives in the gear panel once the court is booked.
- **Pay.** While a player owes, "Pay $14" always shows. A quiet gray "I paid"
  joins it only after they tap Pay for this sign-up (a fresh I'm in starts
  over). The link opens the Venmo app, then the web page if the app didn't
  open. Spaces in the note are %20 and the amount is just "14".
- **Text** in the gear panel is charcoal, its own color family, so it never
  looks like a green button or a blue CourtReserve link.
- **Type (Zip 78).** One font everywhere: the phone's own system font (`-apple-system`, `var(--body)`), for titles too (heavier, never
  a second face). The rounded display font is gone from the site: never on names, levels, numbers, money or sheet titles. Buttons and fields
  take the page font (the browser's default is Arial). Nothing on screen is under 11 px (`font-size: max(11px, ...)` where a size shrinks).
- **Names are never cut.** A name wraps between words (two lines in the header if it needs them), never "…". The only "…" left are a
  settings link, a text preview, the small label over the name and the gray "2 played · Tue Thu" line on the Players tab.
- **No carets.** No chevron, caret or "›" anywhere. A detail row or a folded card may open in place on a tap and close on a second tap; a
  card never hides its only action: every action is a visible button.
- **Colors come only from the tokens** at the top of `src/styles.css` (`var(--...)`): one green, one red, one blue, one amber, one purple,
  one ink, one line, each with its dark value. Private names (`--pc-*`, `--ac-*`, `--ps-*` ...) only point at those tokens. Shadows may use
  see-through black or white. Real art keeps its colors but under names: the tournament ticket (`--tour-*`, the same in both themes), the
  gold (`--gold*`), the ball's light and shade (`--ball-hi`, `--ball-lo`), the medal, tie wheel and ornaments (`--art-*`). The court switch
  colors (`--sw-*`) are defined once. `tests/zip78-look.test.ts` checks all of this.
- **Filled buttons are green or neutral.** The main action is green (`--primary`); everything else is the neutral secondary (gray fill, ink
  words). Amber, blue and purple are for chips, badges and alert tints only. "Mark paid", "Request" and "Text" are the small secondary
  button everywhere (44 px, gray fill, ink words). **Lime means "tournament"** (Alex, Zip 80): every action button on the dark tournament
  ticket and tournament card is lime, the one ball token (`--ball` with `--ball-ink` words; `.tc-lime`: Sign up, Lock in · $18, Hold my spot,
  and the results row's Standings pill, Zip 79). **Enter score on the green Up next card is white with green words** (`.tc-gd-wewon`, both
  styles; Alex likes it). Regular game buttons stay the site green.
- **Sizes.** Buttons: normal 46 px (`--btn-h`), small 44 (`--btn-h-sm`), big 54 (`--btn-h-lg`), one corner (`--btn-r`). Chips: one size
  (`--chip-*`). Cards: one corner (`--card-r`, 20 px). One segmented control (the court switch, In / Out, Games / Totals, the History tabs):
  a gray track, 3 px inside, 12 px corners, 44 px cells.
- **Ball yellow** (`var(--ball)`) only in small doses: the View as bar, the "New" tag, the ball in empty states, the lime words on the
  tournament ticket. Never a filled button, except the tournament action buttons on the dark ticket and tournament card (lime, above;
  `tests/zip78-look.test.ts` allows exactly those).
- **Level up** (Zip 79): its gold is named art (`--art-lu-*`, light and dark), the number in the body font at weight 900.
- **Motion** is CSS only: buttons press down a touch, cards fade in, a
  filled spot springs in, sheets slide up, bubbles pop. All of it turns off
  when the phone's Reduce Motion is on.
- **Space.** Session cards keep the button in its own column beside the
  time and court lines, so no empty gaps. Tap targets stay 44px or more.

## Screenshots

`docs/screenshots/` has every screen at 360 and 390 px, light and dark.
Make fresh ones with `node e2e/shots.cjs` (it runs its own test copy with
made-up players; it never touches the live site).
