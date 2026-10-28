-- Telegram alerts for the organizer. One row per group, made the first time
-- a switch changes or an alert is tried; no row means everything is on.
-- The bot token and chat ID are Cloudflare secrets, never stored here.
CREATE TABLE organizer_alerts (
  group_id TEXT PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  drop_36h INTEGER NOT NULL DEFAULT 1 CHECK (drop_36h IN (0, 1)),
  below_min INTEGER NOT NULL DEFAULT 1 CHECK (below_min IN (0, 1)),
  reached_six INTEGER NOT NULL DEFAULT 1 CHECK (reached_six IN (0, 1)),
  -- The last try: when, whether Telegram took it, and why not in plain words.
  last_at TEXT,
  last_ok INTEGER CHECK (last_ok IN (0, 1)),
  last_error TEXT
);
