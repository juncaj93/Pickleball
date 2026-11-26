-- Zip 94, "Early bird pricing" (EARLY_BIRD, shared/earlyBird.ts): pay early, pay less. Alex OK'd this migration (Thu Nov 26, 2026).
--
-- Additive only: TWO new nullable columns on tournaments. Every row that exists today (The Cold Open included) gets NULL in both, which
-- means "no early bird": its price stays ticket_cents exactly as before. No existing table, column or row is changed, filled, dropped or
-- renamed. Code from before Zip 94 never reads either column, so a code rollback needs NO database step.
--
--   early_cents   the early price, in cents (1800 = $18), lower than ticket_cents (the regular price). NULL: no early bird.
--   early_until   the early deadline, an exact moment, UTC ISO like every *_at column (the organizer picks a day and a time, Eastern), before
--                 Pay by. A player who locks in before it pays early_cents; after it, ticket_cents. NULL: no early bird.
-- Each ticket already keeps the price it was sold at (tournament_tickets.price_cents, Zip 56), so mixed $18 and $20 tickets need no change
-- there: refunds, drop outs, kept late drops and standby all move the money that is really on each ticket.
ALTER TABLE tournaments ADD COLUMN early_cents INTEGER CHECK (early_cents IS NULL OR early_cents >= 0);
ALTER TABLE tournaments ADD COLUMN early_until TEXT;

-- Undo (only to remove the feature's data entirely; a code rollback never needs it):
--   ALTER TABLE tournaments DROP COLUMN early_until;
--   ALTER TABLE tournaments DROP COLUMN early_cents;
