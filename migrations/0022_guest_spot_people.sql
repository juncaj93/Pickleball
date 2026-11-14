-- Zip 42 round 2, "Guest spot" (shared/guestSpot.ts): every person gets their own Played / Did not play and their own paid line, the guest
-- included, while the money stays ONE record on the host's seat. Additive only: two new columns on session_players, NULL for every
-- existing row; nothing is filled, copied, dropped or changed. Needs 0021 first. Code that ignores these columns keeps working.
--
--   guest_played  after Finalize: 1 the guest played, 0 the guest did not (the host's share alone then), NULL not finalized
--   guest_first   1 when the guest's $14 was marked paid before the host's (which person a paid $14 of the pair's $28 belongs to);
--                 NULL or 0: the host's own share is paid first
ALTER TABLE session_players ADD COLUMN guest_played INTEGER CHECK (guest_played IS NULL OR guest_played IN (0, 1));
ALTER TABLE session_players ADD COLUMN guest_first INTEGER CHECK (guest_first IS NULL OR guest_first IN (0, 1));

-- Undo (only to remove the feature's data entirely, after an export): 
--   ALTER TABLE session_players DROP COLUMN guest_first;
--   ALTER TABLE session_players DROP COLUMN guest_played;
