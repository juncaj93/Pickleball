# Stage notes: "any number from 4 to 10 plays" (Oct 29, 2026)

Short notes per stage: what shipped, the restore point, and the tests.
Times are Eastern.

## Before Stage 1 (read-only look at the live site, Thu Oct 29, about 12:05 PM)

- No old $5 credits exist (the `credits` table is empty).
- One credit entry: $14 kept from the canceled Thu Oct 29 game, already used
  on Thu Nov 5 (so that player's pot is $0 and their Nov 5 seat is "paid with
  credit"). The brief said "$14 credit and paid $14 for Tue Nov 3"; the live
  data says the $14 cash payment is on Tue Nov 3 and the credit was spent on
  Nov 5. Nothing to fix; reported here.
- No money is still held on canceled games or by dropped players, so the
  one-time conversion in migration 0013 touches nothing live.
- Tue Nov 3: 4 in (one paid $14). Thu Nov 5: 3 in (one paid with credit).
  Later games: fewer. Settings: 3 weeks ahead, $14, no max yet (default 10).

## Stage 1: rules and the money engine

(filled in at deploy time)
