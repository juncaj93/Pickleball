-- Zip 55, "Tournaments" (TOURNAMENTS, shared/tournament.ts), piece 1 of 4: create a tournament, sign-up, the level list, pick the date.
-- Pieces 2 (tickets and waitlist), 3 (teams, game day, End tournament) and 4 (tie wheel, final) come later. Their tables will be named
-- tournament_tickets, tournament_teams and tournament_games, next to these three.
--
-- Additive only: three NEW tables and their indexes. No existing table, column or row is changed, filled, dropped or renamed. Code that
-- ignores these tables (every build before Zip 55) keeps working on the migrated database, so a code rollback needs NO database step.
-- No money lives here in piece 1: the ticket price and the champion credit are only STORED (piece 2 sells tickets, piece 3 pays the credit).
--
-- Every foreign key says ON DELETE CASCADE, so nothing that already deletes a group or a player (a restore from a backup file, the preview
-- re-seed, Remove player) can ever be stopped by a row here. A restore from a backup FILE does not bring these rows back (they are not in
-- the file yet, see worker/backup.ts BACKUP_LEFT_OUT); Time Travel does.

-- One row per tournament. Reusable every year: name, dates, size, plan, prices and credit are typed on the Create screen; nothing is
-- hard-coded.
--   size            players expected: 6, 8, 10 or 12 (the screen offers only these; the check allows other even sizes for later)
--   courts, minutes, start_minutes
--                   the court plan picked for that size (2 courts, 120 minutes, 1170 = 7:30 PM Eastern)
--   ticket_cents    the ticket price, the same for every size ($16 to start). Stored only in piece 1.
--   champion_credit_cents
--                   the game credit each winner gets ($14 to start, $0 allowed). Stored only in piece 1; paid out in piece 3.
--   offered_dates   the dates to offer, a JSON list of 'YYYY-MM-DD' (Eastern calendar days), sorted
--   final_date      'YYYY-MM-DD' once the organizer picks one (NULL before)
--   status          'signup' (open, players pick their level and dates), 'date_picked' (the date is set; tickets open in piece 2),
--                   'canceled'. Later pieces add 'tickets', 'teams', 'games', 'final' and 'ended' (no check, so they need no table rebuild).
--   visibility      'me' (Only me: only the organizer sees it) or 'all' (Everyone)
--   format          'doubles' (fixed teams for the night) or 'americano' (a new partner every round, everyone plays for themselves). It can
--                   change until tickets open (piece 2), then it is locked.
--   second_credit_cents
--                   Americano only: the game credit for 2nd place ($7 to start, $0 allowed; no medal). 1st place is champion_credit_cents
--                   (plus a medal). Doubles ignores it (champion_credit_cents goes to each of the 2 winners). Stored only in piece 1.
CREATE TABLE tournaments (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size % 2 = 0 AND size BETWEEN 4 AND 24),
  courts INTEGER NOT NULL CHECK (courts BETWEEN 1 AND 4),
  minutes INTEGER NOT NULL CHECK (minutes BETWEEN 60 AND 360),
  start_minutes INTEGER NOT NULL CHECK (start_minutes BETWEEN 0 AND 1439),
  ticket_cents INTEGER NOT NULL CHECK (ticket_cents >= 0),
  champion_credit_cents INTEGER NOT NULL CHECK (champion_credit_cents >= 0),
  offered_dates TEXT NOT NULL,
  final_date TEXT,
  status TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('me', 'all')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  date_picked_at TEXT,
  shown_at TEXT,
  canceled_at TEXT,
  format TEXT NOT NULL DEFAULT 'doubles' CHECK (format IN ('doubles', 'americano')),
  second_credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (second_credit_cents >= 0)
);

-- At most ONE tournament that is not over per group (two quick Create taps can never make two).
CREATE UNIQUE INDEX tournaments_one_open ON tournaments (group_id) WHERE status NOT IN ('ended', 'canceled');

-- One row per player per tournament, kept after a back out (status 'out'), so the level they picked stays with that tournament.
--   status          'in' (on the list) or 'out' (backed out). Piece 2 adds ticket columns or a tickets table; no check here either.
--   picked_level    the player's own pick, in hundredths: 250 = 2.5, 275, 300, 320, 340, 350, 360 = 3.6+
--   approved_level  the organizer's level for this player (NULL: not reviewed yet, the pick stands)
--   dates           the dates this player can make, a JSON list of 'YYYY-MM-DD', every one of them an offered date
--   joined_at       when they last went on the list (the list's order; a back out and a new sign-up go to the end)
CREATE TABLE tournament_signups (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  picked_level INTEGER NOT NULL CHECK (picked_level BETWEEN 100 AND 800),
  approved_level INTEGER CHECK (approved_level IS NULL OR approved_level BETWEEN 100 AND 800),
  dates TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  backed_out_at TEXT,
  UNIQUE (tournament_id, player_id)
);
CREATE INDEX tournament_signups_player ON tournament_signups (player_id);

-- The level history: every level a player picked and every level the organizer set, per tournament, never edited or deleted. Next time
-- the organizer reviews a player's self-rating, this is what they picked and what was set before.
--   set_by          'player' (their own pick at sign-up or Edit sign-up) or 'organizer' (the level list)
CREATE TABLE tournament_level_history (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  level INTEGER NOT NULL CHECK (level BETWEEN 100 AND 800),
  set_by TEXT NOT NULL CHECK (set_by IN ('player', 'organizer')),
  created_at TEXT NOT NULL
);
CREATE INDEX tournament_level_history_player ON tournament_level_history (player_id, created_at);

-- Undo (only to remove the feature's data entirely, after an export; a code rollback never needs it):
--   DROP TABLE tournament_level_history;
--   DROP TABLE tournament_signups;
--   DROP TABLE tournaments;
