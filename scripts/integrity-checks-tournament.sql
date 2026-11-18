-- Zip 56 "Tournaments" piece 2 (tickets) consistency checks: READ-ONLY (SELECT only), counts only, no names, one row, every column should say 0
-- (columns starting with info_ are to-dos, not problems). A separate file from integrity-checks.sql on purpose: these read the table migration
-- 0024 adds, so the older checks still run on a database before 0024 (the "before" run of a deploy).
-- Run on live after the migration (safe, changes nothing):
--   npx wrangler d1 execute pickleball --remote --command "$(grep -v '^\s*--' scripts/integrity-checks-tournament.sql)"
-- Tested by tests/zip56-tickets.test.ts, which also proves each check catches the problem it names.
WITH
-- The organizer's own player, the way the site finds it (server/repo.ts organizerIdOf): the saved player if it still exists, else the first
-- player whose name is the organizer name in Settings.
org AS (
  SELECT g.id AS group_id, COALESCE(
    (SELECT p.id FROM players p WHERE p.id = g.organizer_player_id AND p.group_id = g.id),
    (SELECT p.id FROM players p WHERE p.group_id = g.id AND trim(COALESCE(g.organizer_name, '')) <> ''
       AND lower(trim(p.display_name)) = lower(trim(g.organizer_name)) ORDER BY p.sort_order, p.display_name LIMIT 1)) AS player_id
  FROM groups g
),
tour_used AS (
  SELECT player_id, substr(reason, 6) AS tournament_id, SUM(amount_cents) AS cents
  FROM credit_ledger WHERE kind = 'used' AND ended_at IS NULL AND reason LIKE 'tour:%' AND length(reason) = 41 GROUP BY player_id, substr(reason, 6)
)
SELECT
  -- The credit a ticket says it holds equals its live credit rows (reason 'tour:<tournament id>').
  (SELECT COUNT(*) FROM tournament_tickets k LEFT JOIN tour_used u ON u.player_id = k.player_id AND u.tournament_id = k.tournament_id
     WHERE k.credit_cents <> COALESCE(u.cents, 0)) AS tour_credit_not_ledger
  -- Live ticket credit rows with no ticket.
  ,(SELECT COUNT(*) FROM tour_used u LEFT JOIN tournament_tickets k ON k.player_id = u.player_id AND k.tournament_id = u.tournament_id WHERE k.id IS NULL) AS tour_ledger_without_ticket
  -- More put toward a ticket than its price (the table refuses this too).
  ,(SELECT COUNT(*) FROM tournament_tickets WHERE credit_cents + paid_cents + claim_cents > price_cents) AS tour_over_price
  -- A spot that is not paid in full (the table refuses this too).
  ,(SELECT COUNT(*) FROM tournament_tickets WHERE place = 'spot' AND credit_cents + paid_cents < price_cents) AS tour_spot_unpaid
  -- More than 12 spots taken on a tournament (Alex: the waitlist starts after 12; the database's cap trigger refuses this too).
  ,(SELECT COUNT(*) FROM (SELECT tournament_id FROM tournament_tickets WHERE place = 'spot' GROUP BY tournament_id HAVING COUNT(*) > 12)) AS tour_spots_over_12
  -- Money still on a ticket of a canceled tournament (an I paid still waiting for the organizer is a to-do, below, not a problem).
  ,(SELECT COUNT(*) FROM tournament_tickets k JOIN tournaments t ON t.id = k.tournament_id
     WHERE t.status = 'canceled' AND k.claim_cents = 0 AND k.credit_cents + k.paid_cents > 0) AS tour_money_on_canceled
  -- Money still on the ticket of someone who is off the list (backed out, or taken off by the organizer).
  ,(SELECT COUNT(*) FROM tournament_tickets k JOIN tournament_signups s ON s.tournament_id = k.tournament_id AND s.player_id = k.player_id
     WHERE s.status <> 'in' AND k.claim_cents = 0 AND k.credit_cents + k.paid_cents > 0) AS tour_money_on_left
  -- A spot or a place in line for someone off the list, or on a canceled tournament.
  ,(SELECT COUNT(*) FROM tournament_tickets k JOIN tournaments t ON t.id = k.tournament_id
     LEFT JOIN tournament_signups s ON s.tournament_id = k.tournament_id AND s.player_id = k.player_id
     WHERE k.place <> 'none' AND (COALESCE(s.status, 'out') <> 'in' OR t.status = 'canceled')) AS tour_place_left
  -- The organizer pays the venue, never the group: their own ticket is $0 and holds no money.
  ,(SELECT COUNT(*) FROM tournament_tickets k JOIN tournaments t ON t.id = k.tournament_id JOIN org o ON o.group_id = t.group_id
     WHERE k.player_id = o.player_id AND (k.price_cents > 0 OR k.credit_cents + k.paid_cents + k.claim_cents > 0)) AS tour_organizer_paid
  -- An open spot while someone on the list has paid and waits in line (the line always fills every open spot).
  ,(SELECT COUNT(*) FROM tournaments t WHERE t.status IN ('signup', 'date_picked', 'tickets', 'rescheduled')
     AND (SELECT COUNT(*) FROM tournament_tickets WHERE tournament_id = t.id AND place = 'spot') < 12
     AND EXISTS (SELECT 1 FROM tournament_tickets k JOIN tournament_signups s ON s.tournament_id = k.tournament_id AND s.player_id = k.player_id AND s.status = 'in'
                 WHERE k.tournament_id = t.id AND k.place = 'line' AND k.credit_cents + k.paid_cents >= k.price_cents)) AS tour_paid_line_with_open_spot
  -- Not a problem, a to-do: I paid taps on tickets still waiting for the organizer's answer.
  ,(SELECT COUNT(*) FROM tournament_tickets WHERE claim_cents > 0) AS info_open_ticket_claims;
