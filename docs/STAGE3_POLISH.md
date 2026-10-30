# Stage 3: polish and check (Thu Oct 29, 2026, late evening Eastern)

A short note on the last round after the "any number from 4 to 10" change.
Details, restore points and test totals are in `STAGE_NOTES.md`.

## What changed
- Organizer cards: with 10 in on a 360 to 390 px phone, your own "I'm in"
  used to drop onto a line of its own, so the card grew when the 10th person
  joined. Now the balls wrap onto a second row beside the button.
- Player header: the credit chip lost 8 px of extra space on its right, so
  it sits evenly by the date tile and a long name gets a little more room.
  The header never wraps at 360 px (checked with "Bartholomew" and $1,000).
- Fixes from a fresh audit by a helper that did not write the code:
  - Reopen and "unmark paid" no longer take back credit that a pending refund
    request is holding. Reopen waits with: "Can't reopen: Mitchel asked for
    this credit back. Answer the refund request on Home first."
  - The post-game text says what people actually paid for that game, even if
    "$ each" changes later.
  - "Your $14 is now credit. Request refund" goes away once that credit is spent.
  - Players tab: Undo after "Mark refunded" also shows when some credit is left.
  - "Refund requested" Telegram: one per player an hour, so asking and
    canceling over and over can't use up the hour's 20 alerts.
  - "Price per player" takes whole dollars only.

## Left alone on purpose
- "You get credit back if 5 or more play." (owner will reword it later).
- The thin line at the very bottom of the player page (asked for earlier).

## New tests
- `e2e/circles.cjs`: 0 to 10 in plus a waitlist, both screens, 360/375/390/430
  px, light and dark. No spill, no wrap at 4 or fewer, empty-circle contrast,
  no height jump at the 10th person, Reduce Motion.
- `tests/audit-stage3.test.ts` and `e2e/audit-stage3.cjs`: the auditor's tests.
