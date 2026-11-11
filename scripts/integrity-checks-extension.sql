-- Zip 31 "Extended time" consistency checks: READ-ONLY (SELECT only), counts only, one row, every column should say 0
-- (columns starting with info_ are to-dos, not problems). A separate file from integrity-checks.sql on purpose: these read the
-- columns migration 0019 adds, so the 21 older checks still run on a database before 0019 (the "before" run of a deploy).
-- Run on live after the migration (safe, changes nothing):
--   npx wrangler d1 execute pickleball --remote --command "$(grep -v '^\s*--' scripts/integrity-checks-extension.sql)"
-- Tested by tests/zip31-extension.test.ts.
WITH
ext_ledger AS (
  SELECT player_id, substr(reason, 5) AS session_id,
         SUM(CASE kind WHEN 'used' THEN amount_cents WHEN 'kept' THEN -amount_cents ELSE 0 END) AS net
  FROM credit_ledger WHERE reason LIKE 'ext:%' AND ended_at IS NULL GROUP BY player_id, substr(reason, 5)
)
SELECT
  -- The credit a share says it holds equals the credit rows written for it (used minus put back).
  (SELECT COUNT(*) FROM session_players sp LEFT JOIN ext_ledger l ON l.player_id = sp.player_id AND l.session_id = sp.session_id
     WHERE sp.ext_credit_cents <> COALESCE(l.net, 0)) AS ext_credit_not_ledger
  -- Credit rows for extra time on a game where that player has no share.
  ,(SELECT COUNT(*) FROM ext_ledger l LEFT JOIN session_players sp ON sp.player_id = l.player_id AND sp.session_id = l.session_id
     WHERE sp.id IS NULL OR sp.ext_cents IS NULL) AS ext_ledger_without_share
  -- More put toward a share than the share (money that should have come back as credit).
  ,(SELECT COUNT(*) FROM session_players WHERE ext_cents IS NOT NULL AND ext_credit_cents + ext_paid_cents + ext_claim_cents > ext_cents) AS ext_over_share
  -- Less than nothing put toward a share.
  ,(SELECT COUNT(*) FROM session_players WHERE ext_credit_cents + ext_paid_cents < 0) AS ext_applied_below_zero
  -- The organizer never pays a share.
  ,(SELECT COUNT(*) FROM session_players sp JOIN sessions s ON s.id = sp.session_id JOIN groups g ON g.id = s.group_id
     WHERE sp.player_id = COALESCE(g.organizer_player_id, '') AND COALESCE(sp.ext_cents, 0) > 0) AS ext_on_organizer
  -- Shares add up to no more than what the venue charged for the extra time.
  ,(SELECT COUNT(*) FROM (SELECT s.id FROM sessions s JOIN session_players sp ON sp.session_id = s.id
     GROUP BY s.id HAVING SUM(COALESCE(sp.ext_cents, 0)) > COALESCE(MAX(s.extra_cost_cents), 0))) AS ext_shares_over_cost
  -- A share on a game that is not finalized (Reopen moves every share to $0) or a seat that did not play.
  ,(SELECT COUNT(*) FROM session_players sp JOIN sessions s ON s.id = sp.session_id
     WHERE COALESCE(sp.ext_cents, 0) > 0 AND (s.finalized_at IS NULL OR sp.played IS NOT 1 OR sp.status <> 'confirmed')) AS ext_share_not_played
  -- Not a problem, a to-do: shares still owed or waiting for a confirm.
  ,(SELECT COUNT(*) FROM session_players WHERE ext_cents > ext_credit_cents + ext_paid_cents + ext_claim_cents OR ext_claim_cents > 0) AS info_open_extension_shares;
