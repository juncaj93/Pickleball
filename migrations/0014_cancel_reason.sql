-- "Cancel with a reason": the organizer can say why a game was canceled
-- ("Thanksgiving"), up to 40 characters. Players and the organizer see it next
-- to Canceled. It is cleared when the game is reopened.
--
-- Additive only: one new nullable column. Nothing existing is dropped, renamed
-- or rewritten, and code that ignores the column keeps working.

ALTER TABLE sessions ADD COLUMN cancel_reason TEXT;
