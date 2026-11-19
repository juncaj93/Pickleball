-- Zip 58 (🎾58.tourney4), "Tournaments" piece 4 of 4: ties for a playoff spot (the wheel), End tournament, awards (medals and credit), the
-- winners banner, and each tournament's saved results.
--
-- What changes:
--   1. tournaments: five NEW nullable columns (NULL for every row that exists today).
--   2. Two NEW tables: tournament_ties and tournament_results.
--   3. tournament_games is REBUILT with two CHECK rules widened, so a tie playoff game can be stored: stage may also be 'tie', and play_to may
--      also be 5 (Game A and Game B are to 5). Same columns, same order, same rows: every row is copied as it is, then the old table is dropped
--      and the new one takes its name. No other table points at tournament_games, so nothing else moves.
--   4. ONE new unique index on credit_ledger: a tournament award (reason 'tour:<id>:champion' or 'tour:<id>:second') can exist only once per
--      player and tournament, whatever code path writes it. No existing row has such a reason, so it cannot fail to build.
-- Code from before Zip 58 never reads any of the new columns or tables, and it never writes stage 'tie' or play_to 5, so a code rollback needs
-- NO database step.

-- 1. The end of a tournament and the awards the organizer set before confirming.
--   ended_at      when the organizer tapped "Confirm winners and end" (status becomes 'ended' at the same moment)
--   end_key       a random key written by that one tap; every row the tap writes (results, credit) is guarded on it, so a double tap or a retry
--                 writes them exactly once
--   banner_weeks  how long the winners banner stays up (1 to 4 weeks; NULL means the default, 1 week). Edit awards sets it.
--   banner_until  the moment the winners banner comes down by itself (ended_at plus banner_weeks)
--   award_pick    Edit awards' "Change" pickers, as JSON ({"first": ..., "second": ...}); NULL: the standings decide
ALTER TABLE tournaments ADD COLUMN ended_at TEXT;
ALTER TABLE tournaments ADD COLUMN end_key TEXT;
ALTER TABLE tournaments ADD COLUMN banner_weeks INTEGER CHECK (banner_weeks IS NULL OR banner_weeks BETWEEN 1 AND 4);
ALTER TABLE tournaments ADD COLUMN banner_until TEXT;
ALTER TABLE tournaments ADD COLUMN award_pick TEXT;

-- 2a. One row per tie for a playoff spot that has been settled (or is being settled): the wheel's answer, or the organizer's picks.
--   tie_key     which tie: the group ('P' all teams, 'A' or 'B' a pool) and the tied seats ('P:1,2,4'). A tie that changes (a result fixed in
--               between) has another key, so an old answer never applies to a new tie.
--   kind        'wheel' (three teams tied: the wheel picks a bye) or 'pick' (four or more: the organizer picks, one tap per place)
--   bye_seat    the wheel's answer (chosen by the server, never the phone); NULL until spun
--   picks       the organizer's picks in order, a JSON list of seats ('pick' only)
--   game_a/b    the playoff games the wheel made (tournament_games.num), Game A always, Game B when the tie needs it
--   spun_by     'organizer', or 'team' (a player of the team that spins)
CREATE TABLE tournament_ties (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  tie_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('wheel', 'pick')),
  bye_seat INTEGER,
  picks TEXT,
  game_a INTEGER,
  game_b INTEGER,
  spun_by TEXT,
  spun_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tournament_id, tie_key)
);

-- 2b. One row per player per ended tournament: how they finished, kept for later (the admin Players sheet's TOURNAMENTS card, History's
-- Tournaments chip). Written once, by End tournament. Levels never reach players; they are kept here for the organizer only.
--   finish          1 = won, 2 = runner-up, 3, 4, ... (NULL: not ranked, e.g. left during the night)
--   wins, losses    their record for the night (Locked doubles: their team's games; Americano: their own games)
--   points          Americano only: total points
--   team_name, partner_id   Locked doubles only
--   picked_level, approved_level   as they stood when the tournament ended (hundredths, like tournament_signups)
--   medal           1 = a gold medal (Locked doubles: both winners; Americano: 1st place only)
--   award           'champion' or 'second' (the credit's kind), NULL for everyone else
--   credit_cents    the award credit granted (0 when the amount was $0, or for the organizer, who pays the venue and never holds credit)
--   seen_at         the player tapped Nice on the one-time congratulations card
CREATE TABLE tournament_results (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  finish INTEGER CHECK (finish IS NULL OR finish >= 1),
  wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
  points INTEGER,
  team_name TEXT,
  partner_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  picked_level INTEGER,
  approved_level INTEGER,
  medal INTEGER NOT NULL DEFAULT 0 CHECK (medal IN (0, 1)),
  award TEXT CHECK (award IS NULL OR award IN ('champion', 'second')),
  credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  seen_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (tournament_id, player_id)
);
CREATE INDEX tournament_results_player ON tournament_results (player_id);

-- 3. tournament_games with stage 'tie' and play_to 5 allowed (the columns of 0027 and 0028, in the same order).
CREATE TABLE tournament_games_new (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  num INTEGER NOT NULL CHECK (num >= 1),
  round INTEGER NOT NULL CHECK (round >= 1),
  court INTEGER NOT NULL CHECK (court IN (1, 2)),
  stage TEXT NOT NULL CHECK (stage IN ('pool', 'semi', 'final', 'third', 'tie')),
  pool TEXT CHECK (pool IN ('A', 'B')),
  slot_a TEXT NOT NULL,
  slot_b TEXT NOT NULL,
  play_to INTEGER NOT NULL CHECK (play_to IN (5, 7, 9, 11)),
  claim TEXT CHECK (claim IN ('a', 'b')),
  claim_at TEXT,
  disputed_at TEXT,
  winner TEXT CHECK (winner IN ('a', 'b')),
  result_at TEXT,
  result_by TEXT CHECK (result_by IN ('players', 'organizer', 'skipped')),
  skipped INTEGER NOT NULL DEFAULT 0 CHECK (skipped IN (0, 1)),
  seat_a INTEGER,
  seat_b INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  score_a INTEGER,
  score_b INTEGER,
  claim_by TEXT,
  UNIQUE (tournament_id, num),
  CHECK (skipped = 0 OR winner IS NULL)
);
INSERT INTO tournament_games_new (id, tournament_id, num, round, court, stage, pool, slot_a, slot_b, play_to, claim, claim_at, disputed_at, winner, result_at,
  result_by, skipped, seat_a, seat_b, created_at, updated_at, score_a, score_b, claim_by)
SELECT id, tournament_id, num, round, court, stage, pool, slot_a, slot_b, play_to, claim, claim_at, disputed_at, winner, result_at,
  result_by, skipped, seat_a, seat_b, created_at, updated_at, score_a, score_b, claim_by
FROM tournament_games;
DROP TABLE tournament_games;
ALTER TABLE tournament_games_new RENAME TO tournament_games;

-- 4. A tournament award is granted once: at most one row per player and award reason.
CREATE UNIQUE INDEX credit_ledger_tour_award ON credit_ledger (player_id, reason) WHERE reason LIKE 'tour:%:champion' OR reason LIKE 'tour:%:second';

-- Undo (only to remove piece 4's data entirely, after an export; a code rollback never needs it):
--   DROP INDEX credit_ledger_tour_award; DROP TABLE tournament_results; DROP TABLE tournament_ties;
--   ALTER TABLE tournaments DROP COLUMN award_pick; ... DROP COLUMN banner_until; ... DROP COLUMN banner_weeks; ... DROP COLUMN end_key;
--   ... DROP COLUMN ended_at. (The widened tournament_games checks can stay: old code never writes 'tie' or 5.)
