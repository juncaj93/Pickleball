-- Zip 42, "Guest spot" (GUEST_SPOT, shared/guestSpot.ts): the organizer adds a guest (a plus one) to a player's sign-up.
-- The guest has no account, no phone and gets no texts. The guest takes one real spot, and the guest's $14 sits on the
-- host's own seat, so every payment, credit and refund for the pair is the host's (the credit ledger never sees a guest).
--
-- Additive only: four new columns on session_players, every one NULL for every existing row. Nothing is filled, copied,
-- dropped or changed. Code that ignores these columns (every build before Zip 42) keeps working, so a code rollback needs
-- no database change.
--
--   guest_name    the guest's first name (NULL: no guest on this sign-up)
--   guest_status  'confirmed' (the guest holds a spot), 'waitlisted' (the game was full; waits behind the host),
--                 'late' (the host dropped inside the 12 hours with the guest in and the game fell short: the guest's
--                 $14 is part of the host's late-drop debt until a sub takes that spot), NULL (no guest now)
--   guest_seq     the guest's place in the join order (the same counter as claim_seq), so a waiting guest keeps its turn
--   guest_at      when the guest was added
ALTER TABLE session_players ADD COLUMN guest_name TEXT;
ALTER TABLE session_players ADD COLUMN guest_status TEXT CHECK (guest_status IS NULL OR guest_status IN ('confirmed', 'waitlisted', 'late'));
ALTER TABLE session_players ADD COLUMN guest_seq INTEGER;
ALTER TABLE session_players ADD COLUMN guest_at TEXT;

-- Undo (only to remove the feature's data entirely, after an export; a code rollback never needs it):
--   ALTER TABLE session_players DROP COLUMN guest_at;
--   ALTER TABLE session_players DROP COLUMN guest_seq;
--   ALTER TABLE session_players DROP COLUMN guest_status;
--   ALTER TABLE session_players DROP COLUMN guest_name;
-- Remove every guest first (or accept that hosts with a guest go back to owing $14), because the seat's money for the
-- pair stays on the host's seat either way.
