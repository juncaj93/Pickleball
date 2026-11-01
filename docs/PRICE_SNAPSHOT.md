# Keep the price people signed at (planned for after Tue Nov 3, 2026)

Alex's rule (Oct 31): if the $14 setting changes, existing sign-ups keep the
price they signed at; only new sign-ups use the new price. Not built yet. The
$14 setting stays frozen until it is.

## Why it needs a database change
The site never stored the price a seat signed at. Today every seat that is not
finalized owes the current setting, and Finalize works out the final price from
the current setting. Paid seats keep what they paid, but the price they owed is
not recorded anywhere.

## What it needs
One new table (additive only; nothing existing changes):

```sql
CREATE TABLE seat_prices (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  player_id  TEXT NOT NULL REFERENCES players(id),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  set_at TEXT NOT NULL,
  PRIMARY KEY (session_id, player_id)
);
```

- Written in the same batch as the seat (I'm in, moving in from the waitlist,
  organizer add, claim link): the flat price at that moment. A rejoin after a
  drop is a new sign-up and takes the price at that moment.
- Read wherever the flat price is used for a seat: `pricesFor` (what they owe),
  auto credit (how much credit goes on), the cash-out offer, Mark paid / I paid,
  Use credit, repricing after a reopen.
- Finalize: the final price per game comes from the flat price the seats signed
  at (floor(4 x price / N)). With mixed prices in one game (some signed at $14,
  some at $16) Alex decides the rule first; simplest is "the game keeps the price
  of its first sign-up".
- Seats that exist before the change get no row and fall back to $14 (the only
  price ever used so far), so nothing old needs a backfill.

## Risks
- Every money path reads the price; one missed place charges the new price.
  The random ledger test and the attack suite must run with price changes on
  (`FUZZ_PRICE=1`) before it ships.
- Mixed prices inside one game make the final price and the credit back harder
  to explain on screen.
- A migration on the live database: back up first (Time Travel bookmark and SQL
  export), apply the migration, then deploy the code that uses it.
