-- Each session keeps its own cancellation deadline (Northville's rule is
-- 12 hours before play), and a session can be moved to a new date or time.

-- The Tue/Thu slot a session was generated for. starts_at can change when
-- the organizer reschedules; this stays put, so the schedule never
-- re-creates a session that was moved.
ALTER TABLE sessions ADD COLUMN planned_starts_at TEXT;
UPDATE sessions SET planned_starts_at = starts_at WHERE planned_starts_at IS NULL;
CREATE UNIQUE INDEX idx_sessions_planned ON sessions (group_id, planned_starts_at);

-- Give every session without a deadline the default: 12 hours before play.
UPDATE sessions
SET cancellation_deadline_at = strftime('%Y-%m-%dT%H:%M:%fZ', starts_at, '-12 hours')
WHERE cancellation_deadline_at IS NULL;
