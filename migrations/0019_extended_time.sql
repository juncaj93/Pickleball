-- Zip 31, "Extended time" (EXTENDED_TIME, shared/extension.ts): the organizer adds +30 min or +1 hr of court time when
-- he finalizes a game. The venue charges him the extra time ($12 or $24, one court); every player who played except the
-- organizer pays ROUND UP(cost / N) to the whole dollar (rounded DOWN when rounding up would collect more than the cost),
-- the organizer covers the rest, and each share rides on that player's next game.
--
-- Additive only: new columns, every one NULL or 0 for every existing row, nothing filled, copied or guessed here.
-- Code that ignores these columns (the build before Zip 31) keeps working, so a code rollback needs no database change.
-- The numbers live on rows the screens already read (sessions, session_players), so no screen makes an extra read.
--
-- Per game (written at Finalize, so a later rate change never rewrites history):
--   extra_minutes      30 or 60 (NULL or 0: no extension)
--   extra_cost_cents   what the venue charged for it (1200 or 2400)
ALTER TABLE sessions ADD COLUMN extra_minutes INTEGER CHECK (extra_minutes IS NULL OR extra_minutes IN (0, 30, 60));
ALTER TABLE sessions ADD COLUMN extra_cost_cents INTEGER CHECK (extra_cost_cents IS NULL OR extra_cost_cents >= 0);

-- Per player per game (the seat of the game that was extended):
--   ext_cents          this player's share now (NULL: never had one)
--   ext_credit_cents   credit on it, net: the credit_ledger rows with reason 'ext:<game id>' (used minus kept back).
--                      Can be below 0 when cash paid toward the share was handed back as credit after the share went down.
--   ext_paid_cents     cash paid toward it, confirmed by the organizer
--   ext_claim_cents    an "I paid" the organizer has not confirmed yet (0: none)
--   ext_claim_at       when that "I paid" was tapped
--   ext_last_cents     the latest confirmed cash payment (what Unmark takes off again)
--   ext_paid_at        when the latest cash payment was confirmed
--   ext_via            the next game's seat id when the share was paid together with that game ("$17 due")
--   ext_seen_at        the player closed the alert (X); a new or changed share clears it so the alert comes back
--   ext_at             when the share was last set
-- Owed = ext_cents - ext_credit_cents - ext_paid_cents - ext_claim_cents.
ALTER TABLE session_players ADD COLUMN ext_cents INTEGER CHECK (ext_cents IS NULL OR ext_cents >= 0);
ALTER TABLE session_players ADD COLUMN ext_credit_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session_players ADD COLUMN ext_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (ext_paid_cents >= 0);
ALTER TABLE session_players ADD COLUMN ext_claim_cents INTEGER NOT NULL DEFAULT 0 CHECK (ext_claim_cents >= 0);
ALTER TABLE session_players ADD COLUMN ext_claim_at TEXT;
ALTER TABLE session_players ADD COLUMN ext_last_cents INTEGER NOT NULL DEFAULT 0 CHECK (ext_last_cents >= 0);
ALTER TABLE session_players ADD COLUMN ext_paid_at TEXT;
ALTER TABLE session_players ADD COLUMN ext_via TEXT;
ALTER TABLE session_players ADD COLUMN ext_seen_at TEXT;
ALTER TABLE session_players ADD COLUMN ext_at TEXT;

-- Rollback (never needed for a code rollback; only to remove the feature's data entirely, after an export):
--   ALTER TABLE session_players DROP COLUMN ext_at; ... (each column above, in reverse)
--   ALTER TABLE sessions DROP COLUMN extra_cost_cents; ALTER TABLE sessions DROP COLUMN extra_minutes;
-- Credit moved for an extension stays in credit_ledger (reason 'ext:<game id>', no game id in session_id) and keeps counting in
-- every pot, so dropping the columns never loses a player's credit.

-- "Paid together with the next game" looks shares up by that seat (only rows that have one are in the index).
CREATE INDEX idx_session_players_ext_via ON session_players (ext_via) WHERE ext_via IS NOT NULL;
