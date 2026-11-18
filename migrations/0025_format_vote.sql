-- Zip 60, "Players vote the format" (TOURNAMENTS, shared/tournament.ts): the players vote Locked doubles or Americano when they sign up, and
-- the organizer's date pick decides the format from the votes of the players who can make that date.
--
-- Additive only: TWO new nullable columns, no default, no backfill, no existing row changed. Code from before Zip 60 never reads either, so a
-- code rollback needs NO database step. NULL means "no vote" on a sign-up (counts as Either) and "the organizer chose it" on a tournament.
--
--   tournament_signups.format_vote   'locked' | 'americano' | 'either' (NULL counts as either). A player's own vote; no player ever receives
--                                    another player's vote from the server.
--   tournaments.format_source        how the format was set:
--                                      'vote'  the players vote decides it (before the date is picked the format is "to be decided"; after,
--                                              it is the vote's winner)
--                                      'tie'   the players vote decided it and it was a tie (or nobody picked a side), so the tie rule picked
--                                              the format (the first tournament is Locked doubles, otherwise the opposite of the last one)
--                                      'admin' the organizer changed the format by hand after the vote was open
--                                      NULL    the organizer chose the format when creating it (no vote was ever open)
--                                    No CHECK, like the other status columns.
ALTER TABLE tournament_signups ADD COLUMN format_vote TEXT;
ALTER TABLE tournaments ADD COLUMN format_source TEXT;

-- Undo (only to remove the feature's data entirely, after an export; a code rollback never needs it):
--   ALTER TABLE tournaments DROP COLUMN format_source;
--   ALTER TABLE tournament_signups DROP COLUMN format_vote;
