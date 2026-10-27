-- Part 2: one court with exactly 4 or 6 players, flat price with a refund
-- when 6 play, usual days for suggestions, and venue details for calendars.

-- Usual days, as weekday numbers: '2' = Tuesday, '4' = Thursday, '2,4' = both, '' = none.
ALTER TABLE players ADD COLUMN usual_days TEXT NOT NULL DEFAULT '';

-- Moved in from the waitlist: when, why, and when the organizer told them.
ALTER TABLE session_players ADD COLUMN promoted_at TEXT;
ALTER TABLE session_players ADD COLUMN promotion_reason TEXT
  CHECK (promotion_reason IS NULL OR promotion_reason IN ('made_six', 'spot_opened'));
ALTER TABLE session_players ADD COLUMN promotion_notified_at TEXT;
-- The organizer ticked "Refunded" for this player and session.
ALTER TABLE session_players ADD COLUMN refunded_at TEXT;

ALTER TABLE groups ADD COLUMN organizer_name TEXT;
ALTER TABLE groups ADD COLUMN venue_name TEXT;
ALTER TABLE groups ADD COLUMN venue_address TEXT;

-- Hard cap moves from 4 to 6 confirmed players. (The code itself keeps
-- groups at 4 or 6; this is the backstop for any write path.)
DROP TRIGGER session_players_cap_insert;
DROP TRIGGER session_players_cap_update;

CREATE TRIGGER session_players_cap_insert
BEFORE INSERT ON session_players
WHEN NEW.status = 'confirmed'
  AND (SELECT COUNT(*) FROM session_players WHERE session_id = NEW.session_id AND status = 'confirmed') >= 6
BEGIN
  SELECT RAISE(ABORT, 'session_full');
END;

CREATE TRIGGER session_players_cap_update
BEFORE UPDATE OF status ON session_players
WHEN NEW.status = 'confirmed' AND OLD.status <> 'confirmed'
  AND (SELECT COUNT(*) FROM session_players WHERE session_id = NEW.session_id AND status = 'confirmed') >= 6
BEGIN
  SELECT RAISE(ABORT, 'session_full');
END;
