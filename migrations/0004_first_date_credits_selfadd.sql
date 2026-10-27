-- Part 3: first session date, credits instead of refunds, and players who
-- add their own name.

-- Sessions before this date (YYYY-MM-DD, group time zone) are never shown
-- or generated. The existing group starts Tue, Nov 3, 2026.
ALTER TABLE groups ADD COLUMN first_session_date TEXT;
UPDATE groups SET first_session_date = '2026-11-03' WHERE first_session_date IS NULL;

-- When a session first reached 6 (the discount was shown), and when the
-- organizer dismissed the "dropped below 6" card.
ALTER TABLE sessions ADD COLUMN six_reached_at TEXT;
ALTER TABLE sessions ADD COLUMN six_drop_resolved_at TEXT;
-- Set once the site has looked at a finished session and issued any credits.
ALTER TABLE sessions ADD COLUMN credits_issued_at TEXT;

-- Players who typed their own name on "Who are you?". `is_new` shows the
-- "New" tag until the organizer saves their details.
ALTER TABLE players ADD COLUMN self_added_at TEXT;
ALTER TABLE players ADD COLUMN is_new INTEGER NOT NULL DEFAULT 0 CHECK (is_new IN (0, 1));

-- A $5 credit earned by each of the first four when 6 played. It comes off
-- the player's next session, or the organizer clears it after paying it
-- back by hand.
CREATE TABLE credits (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  earned_session_id TEXT NOT NULL REFERENCES sessions(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TEXT NOT NULL,
  used_session_id TEXT REFERENCES sessions(id),
  used_at TEXT,
  cleared_at TEXT,
  UNIQUE (earned_session_id, player_id)
);

CREATE INDEX idx_credits_player ON credits (player_id);
