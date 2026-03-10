ALTER TABLE puzzle_sessions
  ADD COLUMN IF NOT EXISTS started_from_history boolean NOT NULL DEFAULT false;
