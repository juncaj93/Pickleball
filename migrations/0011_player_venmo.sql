-- Optional: where to send a refund to this player on Venmo. Just the Venmo
-- username (like "Mitchel-K"), or "id:123456" when only a numeric id was
-- known. Organizer only: never shown to players. Blank by default.
ALTER TABLE players ADD COLUMN venmo_handle TEXT;
