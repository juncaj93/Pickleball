-- Zip 61, "Tournaments" (TOURNAMENTS, shared/tournament.ts): the Americano night (every round a new partner, everyone plays for their own points).
--
-- Additive only: THREE new nullable columns on tournament_games (NULL for every row that exists today). No existing row is changed, filled,
-- dropped or renamed. Code from before Zip 61 never reads them, so a code rollback needs NO database step. No money lives here.
--
-- An Americano game is a tournament_games row like a Locked doubles one (zip 57's table), with two players on each side: slot_a and slot_b hold
-- the two player ids with "+" between ('id1+id2'), stage 'pool', pool NULL. The rows are written the first time anything is saved for the night
-- (a score, or an organizer tap); before that every screen works the schedule out from who is locked in (shared/americanoSchedule.ts), so a
-- back out before the night just gives a new schedule.
--   score_a / score_b  the points each side scored (the score that counts, or the one waiting for the other side's Yes)
--   claim_by           the player who entered the score waiting for the other side ("Vic says Round 3 ended 11 to 8"); on a skipped game, the
--                      player who left (their later games are skipped)
-- The existing columns mean what they mean for Locked doubles: claim (the side that entered the score), disputed_at (the other side changed it
-- with "No, fix it"), winner (the score stands: the other side said Yes, or the organizer set it), skipped (never played: someone left).
ALTER TABLE tournament_games ADD COLUMN score_a INTEGER;
ALTER TABLE tournament_games ADD COLUMN score_b INTEGER;
ALTER TABLE tournament_games ADD COLUMN claim_by TEXT;

-- Undo (only to remove the scores entirely, after an export; a code rollback never needs it):
--   ALTER TABLE tournament_games DROP COLUMN claim_by; ALTER TABLE tournament_games DROP COLUMN score_b; ALTER TABLE tournament_games DROP COLUMN score_a;
