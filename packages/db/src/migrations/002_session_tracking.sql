ALTER TABLE puzzle_sessions
  ADD COLUMN IF NOT EXISTS wrong_move_count int NOT NULL DEFAULT 0;

ALTER TABLE puzzle_sessions
  ADD COLUMN IF NOT EXISTS hint_count int NOT NULL DEFAULT 0;
