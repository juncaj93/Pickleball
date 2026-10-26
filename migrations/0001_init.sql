-- Pickleball Club schema (SQLite / Cloudflare D1).
-- All timestamps are UTC ISO-8601 strings, e.g. 2026-10-27T00:00:00.000Z.

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Detroit',
  group_key TEXT NOT NULL UNIQUE,          -- secret part of the private player link
  admin_pin_hash TEXT NOT NULL,            -- PBKDF2 hash, never plaintext
  venmo_url TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  display_name TEXT NOT NULL COLLATE NOCASE,
  phone_number TEXT,
  is_regular INTEGER NOT NULL DEFAULT 1 CHECK (is_regular IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  can_receive_substitute_invites INTEGER NOT NULL DEFAULT 1 CHECK (can_receive_substitute_invites IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (group_id, display_name)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'booked', 'canceled', 'completed')),
  venue_name TEXT,
  venue_booking_url TEXT,
  reservation_reference TEXT,
  booking_status TEXT NOT NULL DEFAULT 'needs_booking' CHECK (booking_status IN ('needs_booking', 'booked', 'unavailable')),
  court_cost_cents INTEGER CHECK (court_cost_cents IS NULL OR court_cost_cents >= 0),
  cancellation_deadline_at TEXT,
  admin_decision TEXT CHECK (admin_decision IS NULL OR admin_decision IN ('try_fill', 'keep')),
  decision_at TEXT,
  canceled_at TEXT,
  canceled_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (group_id, starts_at)
);

CREATE TABLE session_players (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'waitlisted', 'withdrawn', 'declined')),
  claimed_at TEXT NOT NULL,               -- when they joined
  claim_seq INTEGER NOT NULL DEFAULT 0,   -- join order within the session (orders the waitlist)
  confirmed_at TEXT,                      -- when they got a confirmed spot
  confirm_seq INTEGER,                    -- spot order within the session (orders cost shares)
  attendance_confirmed_at TEXT,
  payment_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK (payment_status IN ('unpaid', 'paid', 'not_applicable')),
  paid_at TEXT,
  payment_amount_cents INTEGER,           -- snapshot of the share when marked paid
  payment_updated_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (session_id, player_id)
);

CREATE INDEX idx_session_players_session ON session_players (session_id, status);

-- Hard cap: a session can never hold more than four confirmed players,
-- whatever code path writes the row. Two racing claims for the last spot
-- are serialized by SQLite; the loser hits this trigger.
CREATE TRIGGER session_players_cap_insert
BEFORE INSERT ON session_players
WHEN NEW.status = 'confirmed'
  AND (SELECT COUNT(*) FROM session_players WHERE session_id = NEW.session_id AND status = 'confirmed') >= 4
BEGIN
  SELECT RAISE(ABORT, 'session_full');
END;

CREATE TRIGGER session_players_cap_update
BEFORE UPDATE OF status ON session_players
WHEN NEW.status = 'confirmed' AND OLD.status <> 'confirmed'
  AND (SELECT COUNT(*) FROM session_players WHERE session_id = NEW.session_id AND status = 'confirmed') >= 4
BEGIN
  SELECT RAISE(ABORT, 'session_full');
END;

-- Nobody can take a spot in a canceled session.
CREATE TRIGGER session_players_no_join_canceled_insert
BEFORE INSERT ON session_players
WHEN NEW.status IN ('confirmed', 'waitlisted')
  AND (SELECT status FROM sessions WHERE id = NEW.session_id) = 'canceled'
BEGIN
  SELECT RAISE(ABORT, 'session_canceled');
END;

CREATE TRIGGER session_players_no_join_canceled_update
BEFORE UPDATE OF status ON session_players
WHEN NEW.status IN ('confirmed', 'waitlisted') AND OLD.status NOT IN ('confirmed', 'waitlisted')
  AND (SELECT status FROM sessions WHERE id = NEW.session_id) = 'canceled'
BEGIN
  SELECT RAISE(ABORT, 'session_canceled');
END;

CREATE TABLE session_action_tokens (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  token_hash TEXT NOT NULL UNIQUE,        -- SHA-256 of the random token; raw token is never stored
  action_scope TEXT NOT NULL CHECK (action_scope IN ('attendance', 'claim')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Remembers which saved name a phone picked, so player actions never take a
-- player id from the URL or request body.
CREATE TABLE player_devices (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE login_attempts (
  id TEXT PRIMARY KEY,
  client_key TEXT NOT NULL,
  succeeded INTEGER NOT NULL,
  attempted_at TEXT NOT NULL
);

CREATE INDEX idx_login_attempts_time ON login_attempts (attempted_at);

CREATE TABLE admin_audit_log (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  session_id TEXT,
  actor_label TEXT NOT NULL,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_group_time ON admin_audit_log (group_id, created_at);
