-- Database consistency checks: READ-ONLY (SELECT only), counts only, no
-- names, no amounts per person. One row: every column should say 0
-- (columns starting with info_ are to-dos, not problems).
-- Run on live (safe, changes nothing):
--   npx wrangler d1 execute pickleball --remote --command "$(grep -v '^\s*--' scripts/integrity-checks.sql)"
-- (--command, not --file: --file goes through Cloudflare's import path, meant for loading data).
-- One row, not a UNION: Cloudflare's D1 refuses long compound SELECTs.
-- Tested by tests/audit-behind-integrity.test.ts, which also proves each
-- check catches the problem it names.
WITH
pot AS (
  SELECT player_id,
         SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END) AS cents
  FROM credit_ledger WHERE ended_at IS NULL GROUP BY player_id
),
pending AS (
  SELECT player_id, SUM(amount_cents) AS cents FROM refund_requests WHERE status = 'pending' GROUP BY player_id
),
used_on_seat AS (
  SELECT session_id, player_id, SUM(amount_cents) AS cents FROM credit_ledger
  WHERE kind = 'used' AND ended_at IS NULL AND session_id IS NOT NULL GROUP BY session_id, player_id
),
-- Seats with an "I paid" the organizer has not answered: by design nothing on them moves (not even the
-- credit) until Confirm / Didn't pay, so they are a to-do, not a problem.
claim AS (
  SELECT session_id, player_id FROM session_players WHERE payment_status = 'paid' AND refunded_at IS NULL AND self_paid_at IS NOT NULL
),
-- Open late fees ("Late drops owe $14", shared/lateFees.ts): by design their money stays on the game (a seat that left,
-- or a game canceled late that the venue charged) until the organizer marks them paid or clears them. A to-do, not a problem.
fee AS (
  SELECT sp.session_id, sp.player_id FROM session_players sp JOIN sessions s ON s.id = sp.session_id JOIN groups g ON g.id = s.group_id
  WHERE sp.player_id <> COALESCE(g.organizer_player_id, '') AND sp.late_drop_done_at IS NULL AND (sp.payment_status = 'unpaid' OR (sp.payment_status = 'paid' AND sp.refunded_at IS NULL)) AND (
    (sp.status = 'withdrawn' AND sp.played = 0 AND sp.late_drop_at IS NOT NULL)
    OR (sp.status = 'confirmed' AND s.status = 'canceled' AND COALESCE(s.canceled_by, '') = 'organizer_fee_kept')
    OR (sp.status = 'confirmed' AND s.status <> 'canceled' AND sp.played = 0 AND sp.late_drop_at IS NOT NULL AND sp.late_drop_at = s.finalized_at))
)
SELECT
  (SELECT COUNT(*) FROM session_players sp LEFT JOIN sessions s ON s.id = sp.session_id WHERE s.id IS NULL) AS seat_without_game
  ,(SELECT COUNT(*) FROM session_players sp LEFT JOIN players p ON p.id = sp.player_id WHERE p.id IS NULL) AS seat_without_player
  ,(SELECT COUNT(*) FROM (SELECT 1 FROM session_players GROUP BY session_id, player_id HAVING COUNT(*) > 1)) AS duplicate_seat
  ,(SELECT COUNT(*) FROM credit_ledger c LEFT JOIN players p ON p.id = c.player_id WHERE p.id IS NULL) AS credit_row_without_player
  ,(SELECT COUNT(*) FROM credit_ledger c LEFT JOIN sessions s ON s.id = c.session_id WHERE c.session_id IS NOT NULL AND s.id IS NULL) AS credit_row_without_game
  ,(SELECT COUNT(*) FROM refund_requests r LEFT JOIN players p ON p.id = r.player_id WHERE p.id IS NULL) AS cash_out_without_player
  ,(SELECT COUNT(*) FROM pot WHERE cents < 0) AS pot_below_zero
  ,(SELECT COUNT(*) FROM pending pe LEFT JOIN pot po ON po.player_id = pe.player_id WHERE pe.cents > COALESCE(po.cents, 0)) AS pending_cash_out_over_pot
  ,(SELECT COUNT(*) FROM used_on_seat u JOIN sessions s ON s.id = u.session_id WHERE s.status = 'canceled' AND NOT EXISTS (SELECT 1 FROM claim c WHERE c.session_id = u.session_id AND c.player_id = u.player_id) AND NOT EXISTS (SELECT 1 FROM fee f WHERE f.session_id = u.session_id AND f.player_id = u.player_id)) AS credit_used_on_canceled_game
  ,(SELECT COUNT(*) FROM used_on_seat u LEFT JOIN session_players sp ON sp.session_id = u.session_id AND sp.player_id = u.player_id WHERE (sp.id IS NULL OR sp.status IN ('withdrawn', 'declined')) AND NOT EXISTS (SELECT 1 FROM claim c WHERE c.session_id = u.session_id AND c.player_id = u.player_id) AND NOT EXISTS (SELECT 1 FROM fee f WHERE f.session_id = u.session_id AND f.player_id = u.player_id)) AS credit_used_on_left_seat
  ,(SELECT COUNT(*) FROM used_on_seat WHERE cents > 1400) AS credit_on_seat_over_14
  -- "Card cleanup" (Zip 10) on for everyone: no Max players cap, so the limit is the database's own 12.
  ,(SELECT COUNT(*) FROM (SELECT session_id FROM session_players WHERE status = 'confirmed' GROUP BY session_id HAVING COUNT(*) > CASE WHEN EXISTS (SELECT 1 FROM task_log WHERE task = 'card_cleanup_on' AND kind = 'mark' AND session_id IS NULL) THEN 12 ELSE COALESCE((SELECT json_extract(settings_json, '$.maxPlayers') FROM groups LIMIT 1), 10) END)) AS more_in_than_max
  ,(SELECT COUNT(*) FROM session_players WHERE payment_status = 'paid' AND payment_amount_cents IS NULL) AS paid_seat_without_amount
  -- Cash on a canceled game turns into credit at once, except an "I paid" the organizer has not answered yet
  -- (it waits for Confirm / Didn't pay) and the organizer's own court payment (never credit).
  ,(SELECT COUNT(*) FROM session_players sp JOIN sessions s ON s.id = sp.session_id JOIN groups g ON g.id = s.group_id WHERE s.status = 'canceled' AND sp.payment_status = 'paid' AND sp.refunded_at IS NULL AND sp.self_paid_at IS NULL AND sp.player_id <> COALESCE(g.organizer_player_id, '') AND sp.status <> 'declined' AND NOT EXISTS (SELECT 1 FROM fee f WHERE f.session_id = sp.session_id AND f.player_id = sp.player_id)) AS cash_still_on_canceled_game
  -- Not a problem, a to-do: "I paid" taps on canceled games still waiting for the organizer's answer.
  ,(SELECT COUNT(*) FROM session_players sp JOIN sessions s ON s.id = sp.session_id WHERE s.status = 'canceled' AND sp.payment_status = 'paid' AND sp.refunded_at IS NULL AND sp.self_paid_at IS NOT NULL) AS info_unanswered_i_paid_on_canceled_game
  -- Not a problem, a to-do: late fees still open (owed or paid, not cleared).
  ,(SELECT COUNT(*) FROM fee) AS info_open_late_fees
  ,(SELECT COUNT(*) FROM sessions WHERE finalized_at IS NOT NULL AND (final_price_cents IS NULL OR final_played_count IS NULL)) AS finalized_without_price
  ,(SELECT COUNT(*) FROM (SELECT 1 FROM sessions WHERE status <> 'canceled' GROUP BY group_id, starts_at HAVING COUNT(*) > 1)) AS two_games_same_start
  ,(SELECT COUNT(*) FROM sessions WHERE ends_at <= starts_at) AS game_ends_before_start
  ,(SELECT COUNT(*) FROM task_log t LEFT JOIN sessions s ON s.id = t.session_id WHERE t.session_id IS NOT NULL AND s.id IS NULL) AS alert_log_without_game
  ,(SELECT COUNT(*) FROM (SELECT 1 FROM task_log WHERE kind = 'sent' GROUP BY session_id, task HAVING COUNT(*) > 1)) AS alert_sent_twice;
