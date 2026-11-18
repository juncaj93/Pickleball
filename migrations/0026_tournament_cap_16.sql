-- Zip 63, "Tickets" (TOURNAMENTS, shared/tournament.ts MAX_SPOTS): the hidden cap of locked-in players goes from 12 to 16.
--
-- The two triggers from 0024 refuse a 13th spot. They are replaced by the same two triggers with 16. No table, column or row changes: only
-- the number in the two WHEN clauses. A tournament that already holds 12 spots or fewer is untouched.
--
-- Rollback: code from before Zip 63 checks 12 itself (MAX_SPOTS = 12) before it writes, so it never tries a 13th spot and this migration can
-- stay. To put the old cap back in the database too (only if no tournament holds more than 12 spots):
--   DROP TRIGGER tournament_tickets_cap_insert; DROP TRIGGER tournament_tickets_cap_update;
--   then the two CREATE TRIGGER statements of 0024 as they were (with 12).
DROP TRIGGER IF EXISTS tournament_tickets_cap_insert;
DROP TRIGGER IF EXISTS tournament_tickets_cap_update;

CREATE TRIGGER tournament_tickets_cap_insert
BEFORE INSERT ON tournament_tickets
WHEN NEW.place = 'spot'
  AND (SELECT COUNT(*) FROM tournament_tickets WHERE tournament_id = NEW.tournament_id AND place = 'spot') >= 16
BEGIN
  SELECT RAISE(ABORT, 'tournament_full');
END;

CREATE TRIGGER tournament_tickets_cap_update
BEFORE UPDATE OF place ON tournament_tickets
WHEN NEW.place = 'spot' AND OLD.place <> 'spot'
  AND (SELECT COUNT(*) FROM tournament_tickets WHERE tournament_id = NEW.tournament_id AND place = 'spot') >= 16
BEGIN
  SELECT RAISE(ABORT, 'tournament_full');
END;
