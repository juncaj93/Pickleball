-- Credit a player can keep and spend on any later game, one pot per player.
-- A new table only: nothing existing is changed or moved.
--
--   kept      money paid for a game that was canceled (or a paid player left it)
--             that the organizer chose to keep as credit. Adds to the pot.
--   used      credit spent on a game ("Use credit"). Takes from the pot.
--   refunded  the pot (or part of it) paid back by hand on Venmo. Takes from the pot.
--
-- Entries are never deleted. An entry that was undone, or that went back to the
-- player (they dropped out of the game it paid for), gets `ended_at` and stops
-- counting.
CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  kind TEXT NOT NULL CHECK (kind IN ('kept', 'used', 'refunded')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  -- For a refund of the pot only: how much of amount_cents came from the older
  -- $5 credits (those live in the credits table). The rest came from this pot.
  five_cents INTEGER NOT NULL DEFAULT 0 CHECK (five_cents >= 0 AND five_cents <= amount_cents),
  -- The game it came from (kept) or went to (used). Empty for a refund of the pot.
  session_id TEXT REFERENCES sessions(id),
  created_at TEXT NOT NULL,
  ended_at TEXT,
  ended_reason TEXT CHECK (ended_reason IS NULL OR ended_reason IN ('undone', 'unmarked', 'dropped', 'canceled')),
  -- The older $5 credits this entry touched, as a list of ids, so undoing it
  -- can put them back: the ones handed back with a kept payment, or the ones
  -- cleared with a refund of the pot.
  five_credit_ids TEXT
);

CREATE INDEX idx_credit_ledger_player ON credit_ledger (player_id, ended_at);
CREATE INDEX idx_credit_ledger_session ON credit_ledger (session_id, player_id);
