-- Open address: anyone with the site address can use it (the long private
-- link keeps working). The organizer can switch back to link-only, and can
-- set an optional group word that a new phone is asked for once.
ALTER TABLE groups ADD COLUMN open_access INTEGER NOT NULL DEFAULT 1 CHECK (open_access IN (0, 1));
-- SHA-256 of the lowercased group word; never stored as typed.
ALTER TABLE groups ADD COLUMN group_word_hash TEXT;

-- Simple rate limits (new names per phone, group-word guesses), kept apart
-- from the organizer PIN lockout so they never affect it.
CREATE TABLE rate_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  client_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_rate_events ON rate_events (kind, client_key, created_at);
