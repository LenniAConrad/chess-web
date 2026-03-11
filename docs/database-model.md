# Database Model

## Core Tables

Defined in `packages/db/src/migrations/001_init.sql`:

- `puzzles`: puzzle metadata + randomized selection keys.
- `puzzle_nodes`: move tree for each puzzle (`parent_id`, `uci`, `san`, `actor`, `is_mainline`).
- `anon_sessions`: anonymous user identity keyed by cookie/session id.
- `puzzle_sessions`: per-user puzzle attempt state and progress counters.
- `rate_limit_events`: persisted rate-limit decision log.
- `daily_metrics`: aggregated activity counters by day.
- `puzzle_import_jobs`: import bookkeeping.

Follow-up migrations add behavior tracking fields to `puzzle_sessions`:

- `wrong_move_count` (002)
- `hint_count` (002)
- `autoplay_used` (003)
- `started_from_history` (004)

## Key Relationships

- `puzzle_nodes.puzzle_id -> puzzles.id`
- `puzzles.root_node_id -> puzzle_nodes.id`
- `puzzle_sessions.puzzle_id -> puzzles.id`
- `puzzle_sessions.anon_session_id -> anon_sessions.id`

Deleting a puzzle cascades to its nodes and related puzzle sessions.

## Random Puzzle Selection Strategy

Repository: `packages/db/src/repositories/puzzles.ts#getRandomPuzzle`.

To avoid `ORDER BY random()`:

1. Choose random bucket in `[0, 1023]`.
2. Choose random key in `[0, 1)`.
3. Try nearest puzzle in same bucket with `random_key >= chosen`.
4. Fallback to first in same bucket.
5. Fallback to next/previous buckets.
6. Final fallback to global minimum key (when exclusion removes candidates).

This keeps random selection indexed and scalable with large datasets.

## Session Persistence

Repository: `packages/db/src/repositories/sessions.ts`.

`puzzle_sessions.branch_cursor` stores the engine cursor in JSON:

- `lineIndex`
- `cursorIndex`

Session writes occur on every user action, so backend recovery is deterministic and stateless with respect to in-memory API process state.

## Local Development Behavior

`apps/api/src/app.ts` starts with configured `DATABASE_URL`, runs migrations, and falls back to `pgmem://local` when primary database is unavailable in local setup.
