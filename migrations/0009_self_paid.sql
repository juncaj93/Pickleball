-- A player tapped "I paid" themselves. Cleared when the organizer marks it
-- paid (confirming it) or when anyone unmarks it.
ALTER TABLE session_players ADD COLUMN self_paid_at TEXT;
