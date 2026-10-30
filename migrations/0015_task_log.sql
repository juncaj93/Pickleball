-- "Do this now" card and smart Telegram alerts: one log of task marks and
-- sent alerts.
--   kind 'mark'   the organizer tapped a card button (task = night_text,
--                 court_canceled, canceled_text or postgame_text)
--   kind 'sent'   a smart alert went to Telegram (task = the alert, like
--                 night or book); written before sending, so it goes once
--   kind 'failed' a send that did not go through, with the reason in detail
--                 (retried on the next tick within the catch-up hour)
--   kind 'off'    the Settings > Alerts "Smart alerts" switch is off
--                 (session_id is empty; no row means on)
--
-- Additive only: one new table. Nothing existing is dropped, renamed or
-- rewritten, and code that ignores this table keeps working.

CREATE TABLE task_log (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mark', 'sent', 'failed', 'off')),
  detail TEXT,
  at TEXT NOT NULL
);

-- A mark or a sent alert exists at most once per game.
CREATE UNIQUE INDEX task_log_once ON task_log (session_id, task, kind) WHERE kind IN ('mark', 'sent');
CREATE INDEX task_log_group ON task_log (group_id, kind, at);
