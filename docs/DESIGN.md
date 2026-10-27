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
- **Date tiles** are white with a thin dark outline (dark mode: dark
  surface, light outline). The weekday is green, the month gray.
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
