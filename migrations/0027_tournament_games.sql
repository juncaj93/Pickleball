-- Zip 57, "Tournaments" (TOURNAMENTS, shared/tournament.ts), piece 3 of 4: Locked doubles teams, the schedule, game day results.
-- Piece 4 (ties, the wheel, End tournament, medals, credit) comes later.
--
-- Additive only: TWO new tables and THREE new nullable columns on tournaments (NULL for every row that exists today). No existing row is changed,
-- filled, dropped or renamed. Code from before Zip 57 never reads any of it, so a code rollback needs NO database step. No money lives here: a
-- result is only who won a game (scores are not kept in piece 3).

-- When the organizer published the teams (players see their partner and team name only after it). NULL: not published (a draft, or none).
ALTER TABLE tournaments ADD COLUMN teams_at TEXT;
-- The venue's court numbers for the night, a JSON list in court order ('[9,10]'), set by the organizer. NULL: not set (the screens say Court 1
-- and Court 2).
ALTER TABLE tournaments ADD COLUMN court_numbers TEXT;
-- The organizer paused game day (players see "Paused"); NULL: not paused.
ALTER TABLE tournaments ADD COLUMN paused_at TEXT;

-- One row per team (Locked doubles: two players, the same partner all night), made by Draft teams. `seat` is the team's place in the schedule
-- (1 to 8; with two pools Pool A holds the first seats). A player who is removed from the site leaves an empty place (SET NULL), never a failed
-- delete. `out_at`: the team left during the night (its games still to play are skipped). `changed_at`: a partner changed after publishing (the
-- players get a one-time note).
CREATE TABLE tournament_teams (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  seat INTEGER NOT NULL CHECK (seat BETWEEN 1 AND 8),
  name TEXT NOT NULL,
  player_a TEXT REFERENCES players(id) ON DELETE SET NULL,
  player_b TEXT REFERENCES players(id) ON DELETE SET NULL,
  pool TEXT CHECK (pool IN ('A', 'B')),
  out_at TEXT,
  changed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tournament_id, seat)
);
CREATE INDEX tournament_teams_tournament ON tournament_teams (tournament_id);

-- One row per game of the night, made when the teams are published (shared/tournamentSchedule.ts schedule(): a pure function of the teams and
-- the courts). `slot_a` / `slot_b` say who plays: 'T3' (the team in seat 3), 'A1' (1st of Pool A), 'P2' (2nd of the round robin), 'W12' (the
-- winner of game 12); the playoffs are filled in from the results as they come.
--   play_to     11, 9 or 7 (the plan's length; the Time check can lower it for pool games not started)
--   claim       the side a team says won ('a' or 'b'), waiting for the other team's Confirm; counts at once (the site trusts players)
--   disputed_at the other team said "No, we won": the organizer decides (the result counts for nobody until then)
--   winner      the result that stands ('a' or 'b'): confirmed by the other team, given by the losing team, or set by the organizer
--   result_by   'players', 'organizer' or 'skipped'
--   skipped     1: never played (a team left during the night); it counts for nobody
--   seat_a/b    the teams (seats) in the game when it got its result: a later change to an earlier game never moves this result to other teams
CREATE TABLE tournament_games (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  num INTEGER NOT NULL CHECK (num >= 1),
  round INTEGER NOT NULL CHECK (round >= 1),
  court INTEGER NOT NULL CHECK (court IN (1, 2)),
  stage TEXT NOT NULL CHECK (stage IN ('pool', 'semi', 'final', 'third')),
  pool TEXT CHECK (pool IN ('A', 'B')),
  slot_a TEXT NOT NULL,
  slot_b TEXT NOT NULL,
  play_to INTEGER NOT NULL CHECK (play_to IN (7, 9, 11)),
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
  UNIQUE (tournament_id, num),
  -- A skipped game has no winner.
  CHECK (skipped = 0 OR winner IS NULL)
);

-- Undo (only to remove piece 3's data entirely, after an export; a code rollback never needs it):
--   DROP TABLE tournament_games; DROP TABLE tournament_teams;
--   ALTER TABLE tournaments DROP COLUMN paused_at; ALTER TABLE tournaments DROP COLUMN court_numbers; ALTER TABLE tournaments DROP COLUMN teams_at;
