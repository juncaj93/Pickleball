-- Part 4: court numbers, the venue's court waitlist, showing a session that
-- falls before the first session date, holiday hours, and the day-before /
-- last-call cards.

ALTER TABLE sessions ADD COLUMN court_number TEXT;

-- The organizer's spot on the venue's own waitlist for a court.
-- 'waitlist': waiting (players can only go on standby)
-- 'opened': the court came through
-- 'not_opened': it didn't; the session is marked off
ALTER TABLE sessions ADD COLUMN court_state TEXT
  CHECK (court_state IS NULL OR court_state IN ('waitlist', 'opened', 'not_opened'));

-- "Show this session" for one that's before the first session date.
ALTER TABLE sessions ADD COLUMN shown_early INTEGER NOT NULL DEFAULT 0 CHECK (shown_early IN (0, 1));

-- Organizer confirmed the venue keeps normal hours on this holiday.
ALTER TABLE sessions ADD COLUMN holiday_hours_ok_at TEXT;

-- "Done" on the day-before and last-call cards.
ALTER TABLE sessions ADD COLUMN day_before_done_at TEXT;
ALTER TABLE sessions ADD COLUMN last_call_done_at TEXT;
