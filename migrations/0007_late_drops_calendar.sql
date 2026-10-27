-- Late drops: a confirmed player dropping out once the day-before check-in
-- window has opened (24 hours before play by default).
ALTER TABLE session_players ADD COLUMN late_drop_at TEXT;
-- The organizer tapped Done on the late-drop card.
ALTER TABLE session_players ADD COLUMN late_drop_done_at TEXT;

-- Private calendar subscription links. NULL token: not made yet.
-- calendar_off = 1: the organizer turned this person's link off.
ALTER TABLE players ADD COLUMN calendar_token TEXT;
ALTER TABLE players ADD COLUMN calendar_off INTEGER NOT NULL DEFAULT 0 CHECK (calendar_off IN (0, 1));
CREATE UNIQUE INDEX players_calendar_token ON players(calendar_token) WHERE calendar_token IS NOT NULL;

-- The organizer's own calendar of every session.
ALTER TABLE groups ADD COLUMN calendar_token TEXT;
CREATE UNIQUE INDEX groups_calendar_token ON groups(calendar_token) WHERE calendar_token IS NOT NULL;
