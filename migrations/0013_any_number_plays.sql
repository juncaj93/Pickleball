-- "Any number from 4 to 10 plays": everyone pays the flat price up front, the
-- organizer finalizes who played after the game, and the final price is
-- 4 x price / players who played, rounded down to whole dollars. What anyone
-- paid above that comes back as credit. Money that comes back for any reason
-- (drop, cancel, did not play) becomes credit automatically, and a player can
-- ask for a refund of their credit.
--
-- Additive only: new nullable columns, new tables, new switches. Nothing
-- existing is dropped, renamed or rewritten. The cap trigger is widened.

-- The organizer finalized the game: when, the final price per player, and how many played.
ALTER TABLE sessions ADD COLUMN finalized_at TEXT;
ALTER TABLE sessions ADD COLUMN final_price_cents INTEGER CHECK (final_price_cents IS NULL OR final_price_cents >= 0);
ALTER TABLE sessions ADD COLUMN final_played_count INTEGER CHECK (final_played_count IS NULL OR final_played_count >= 0);

-- Set when the game is finalized: 1 played, 0 did not. NULL until then.
ALTER TABLE session_players ADD COLUMN played INTEGER CHECK (played IS NULL OR played IN (0, 1));

-- Why a credit entry exists, in one word, so the history reads right:
--   finalized   money back after the game: paid more than the final price
--   not_played  did not play: what they paid came back in full
--   dropped     tapped I'm out after paying
--   canceled    the organizer canceled the game
--   migrated    held money converted to credit when this model went live
--   request     a refund the player asked for (kind 'refunded')
ALTER TABLE credit_ledger ADD COLUMN reason TEXT;
-- For 'finalized' entries: how many played, for the "+$5 Thu, Oct 29 (6 played)" line.
ALTER TABLE credit_ledger ADD COLUMN played_count INTEGER;

-- Settings > Alerts: "A game reaches 4 (it's on)" and "Refund requests".
-- (reached_six is no longer read.)
ALTER TABLE organizer_alerts ADD COLUMN reached_min INTEGER NOT NULL DEFAULT 1 CHECK (reached_min IN (0, 1));
ALTER TABLE organizer_alerts ADD COLUMN refund_requests INTEGER NOT NULL DEFAULT 1 CHECK (refund_requests IN (0, 1));

-- A player asking for cash back from their credit. While pending the amount is
-- reserved (it can't be spent on a game). One open request per player.
CREATE TABLE refund_requests (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  -- pending: waiting on the organizer. refunded: paid back (a 'refunded' ledger
  -- entry points here). canceled: the player took it back. declined: "Not now".
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'refunded', 'canceled', 'declined')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  ledger_id TEXT REFERENCES credit_ledger(id)
);

CREATE INDEX idx_refund_requests_player ON refund_requests (player_id, status);
CREATE UNIQUE INDEX idx_refund_requests_one_open ON refund_requests (player_id) WHERE status = 'pending';

-- Hard cap moves from 6 to 12 confirmed players (the widest "Max players per
-- game" allowed). The code keeps a session at the organizer's own max.
DROP TRIGGER session_players_cap_insert;
DROP TRIGGER session_players_cap_update;

CREATE TRIGGER session_players_cap_insert
BEFORE INSERT ON session_players
WHEN NEW.status = 'confirmed'
  AND (SELECT COUNT(*) FROM session_players WHERE session_id = NEW.session_id AND status = 'confirmed') >= 12
BEGIN
  SELECT RAISE(ABORT, 'session_full');
END;

CREATE TRIGGER session_players_cap_update
BEFORE UPDATE OF status ON session_players
WHEN NEW.status = 'confirmed' AND OLD.status <> 'confirmed'
  AND (SELECT COUNT(*) FROM session_players WHERE session_id = NEW.session_id AND status = 'confirmed') >= 12
BEGIN
  SELECT RAISE(ABORT, 'session_full');
END;

-- One-time conversion: money still held for a game that was already canceled,
-- or paid by someone who had already dropped out, becomes that player's credit
-- (what the organizer used to decide with Refund / Keep as credit). The
-- organizer's own court payments are never credit. Expected to touch nothing
-- on the live site (checked read-only first); it is here so a restored backup
-- lands in the same state.
INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, five_cents, session_id, created_at, reason)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-'
    || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  s.group_id, sp.player_id, 'kept', sp.payment_amount_cents, 0, sp.session_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'migrated'
FROM session_players sp
JOIN sessions s ON s.id = sp.session_id
JOIN groups g ON g.id = s.group_id
WHERE sp.payment_status = 'paid' AND sp.refunded_at IS NULL AND COALESCE(sp.payment_amount_cents, 0) > 0
  AND (s.status = 'canceled' OR sp.status = 'withdrawn')
  AND sp.player_id <> COALESCE(g.organizer_player_id, '');

UPDATE session_players SET refunded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE refunded_at IS NULL AND payment_status = 'paid'
  AND EXISTS (SELECT 1 FROM credit_ledger l WHERE l.reason = 'migrated' AND l.session_id = session_players.session_id AND l.player_id = session_players.player_id AND l.ended_at IS NULL);
