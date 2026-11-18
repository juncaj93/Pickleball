-- Zip 56, "Tournaments" (TOURNAMENTS, shared/tournament.ts), piece 2 of 4: tickets, the waitlist, paying, backing out, cancel or reschedule.
-- Piece 3 (teams, game day, End tournament) and piece 4 (tie wheel, final) come later.
--
-- Additive only: ONE new column on tournaments (NULL for every row that exists today) and ONE new table. No existing row is changed, filled,
-- dropped or renamed. Code from before Zip 56 never reads either, so a code rollback needs NO database step.
--
-- The money itself follows the site's existing rules and lives where all money lives:
--   credit used on a ticket   credit_ledger kind 'used', reason 'tour:<tournament id>', no session_id (like Zip 31's 'ext:<game id>')
--   money back as credit      credit_ledger kind 'kept', reason 'tour:<tournament id>:<why>' (cash), or the 'used' row ended (credit)
--   cash paid to the organizer the ticket's paid_cents below (an "I paid" waits in claim_cents until the organizer confirms it)
-- So a player's pot (one per player) and every credit rule are exactly the site's own.

-- When ticket money is due ("Pay by"): an exact moment, UTC ISO like every *_at column. Set when the organizer picks the date, which opens
-- tickets (default: two days before the date at 7:00 PM Eastern; Tuesday 7:00 PM for a Thursday game), changeable while tickets are open.
-- NULL: tickets never opened.
-- A tournament with pay_by set has had tickets open (picking the date opens them), so its price and format stay locked (a Reschedule keeps them).
ALTER TABLE tournaments ADD COLUMN pay_by TEXT;

-- One row per player per tournament, made the first time they touch tickets (Lock my spot, Join waitlist, the organizer's own seat).
--   place         'spot' (locked in: one of the spots), 'line' (on the waitlist), 'none' (neither: not placed yet, backed out, or canceled)
--   place_at      when they took the spot or joined the line: the order of Who's in and of the waitlist
--   price_cents   the ticket price this ticket is for (the tournament's flat price; 0 for the organizer, who pays the venue, not the group)
--   credit_cents  credit from the pot on it now: always equal to its live 'used' rows in credit_ledger (reason 'tour:<tournament id>')
--   paid_cents    cash the organizer confirmed (Confirm on an "I paid", or Mark paid)
--   claim_cents   an "I paid" the organizer has not answered yet (only confirmed money ever becomes credit, the site's rule)
--   claim_at      when that "I paid" was tapped
--   paid_at       when the ticket was paid in full (credit and confirmed cash)
-- Back out, Take off and Cancel put credit_cents and paid_cents back to 0 in the same all-or-nothing batch that writes the credit.
CREATE TABLE tournament_tickets (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  place TEXT NOT NULL DEFAULT 'none' CHECK (place IN ('spot', 'line', 'none')),
  place_at TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  claim_cents INTEGER NOT NULL DEFAULT 0 CHECK (claim_cents >= 0),
  claim_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tournament_id, player_id),
  -- Never more put toward a ticket than its price.
  CHECK (credit_cents + paid_cents + claim_cents <= price_cents),
  -- A spot is always paid in full (credit and confirmed cash): no code path can lock in someone who has not paid.
  CHECK (place <> 'spot' OR credit_cents + paid_cents >= price_cents)
);
CREATE INDEX tournament_tickets_player ON tournament_tickets (player_id);

-- Hard cap: a tournament never holds more than 12 spots (Alex: the spots follow the players locked in; the waitlist starts after 12), whatever
-- code path writes the row (as session_players_cap does for games).
CREATE TRIGGER tournament_tickets_cap_insert
BEFORE INSERT ON tournament_tickets
WHEN NEW.place = 'spot'
  AND (SELECT COUNT(*) FROM tournament_tickets WHERE tournament_id = NEW.tournament_id AND place = 'spot') >= 12
BEGIN
  SELECT RAISE(ABORT, 'tournament_full');
END;

CREATE TRIGGER tournament_tickets_cap_update
BEFORE UPDATE OF place ON tournament_tickets
WHEN NEW.place = 'spot' AND OLD.place <> 'spot'
  AND (SELECT COUNT(*) FROM tournament_tickets WHERE tournament_id = NEW.tournament_id AND place = 'spot') >= 12
BEGIN
  SELECT RAISE(ABORT, 'tournament_full');
END;

-- Undo (only to remove the feature's data entirely, after an export, and only when no ticket holds money: a ticket's cash lives only here;
-- a code rollback never needs it):
--   DROP TRIGGER tournament_tickets_cap_update;
--   DROP TRIGGER tournament_tickets_cap_insert;
--   DROP TABLE tournament_tickets;
--   ALTER TABLE tournaments DROP COLUMN pay_by;
