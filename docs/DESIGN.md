# Pickleball Bros design notes

The look follows Apple's own iPhone apps: calm gray background, white cards,
clear type, quick to scan. All of it lives in `src/styles.css`, tokens first.

## Rules

- **One green button per card at most.** Green is the accent for the main
  action (I'm in, Pay, I booked it, Court opened). Everything else is soft
  gray or outlined. The browser tests count this on every screen.
- **Status colors keep their meaning.** Green: court booked (solid left
  edge). Amber, dashed: court not booked. Gray: booking not open yet. Blue:
  on the court waitlist. Red: cancel only.
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
- **Type.** System font (`-apple-system`) for body and buttons. Bricolage
  Grotesque (self-hosted from the `@fontsource-variable` package, no outside
  requests) for titles, times, date numerals and money amounts.
- **Ball yellow** only in small doses: the View as bar, the "New" tag, the
  ball in empty states.
- **Motion** is CSS only: buttons press down a touch, cards fade in, a
  filled spot springs in, sheets slide up, bubbles pop. All of it turns off
  when the phone's Reduce Motion is on.
- **Space.** Session cards keep the button in its own column beside the
  time and court lines, so no empty gaps. Tap targets stay 44px or more.

## Screenshots

`docs/screenshots/` has every screen at 360 and 390 px, light and dark.
Make fresh ones with `node e2e/shots.cjs` (it runs its own test copy with
made-up players; it never touches the live site).
