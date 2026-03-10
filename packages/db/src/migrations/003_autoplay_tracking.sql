ALTER TABLE puzzle_sessions
  ADD COLUMN IF NOT EXISTS autoplay_used boolean NOT NULL DEFAULT false;
