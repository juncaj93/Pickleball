-- One-off games the organizer adds by hand (not from the Tue/Thu schedule).
-- They have no planned_starts_at, so the schedule never touches them.
ALTER TABLE sessions ADD COLUMN is_extra INTEGER NOT NULL DEFAULT 0 CHECK (is_extra IN (0, 1));
-- An optional short note shown with the game ("Court 3", "Bring water").
ALTER TABLE sessions ADD COLUMN note TEXT;

-- The organizer's own player record, so they can sign up like anyone else.
ALTER TABLE groups ADD COLUMN organizer_player_id TEXT;
