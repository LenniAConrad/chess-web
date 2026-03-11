# Architecture

## Monorepo Structure

This project is a `pnpm` workspace with two apps and shared packages:

- `apps/web`: React + Vite client UI.
- `apps/api`: Fastify API for session orchestration and persistence.
- `packages/chess-core`: pure puzzle domain logic (PGN parsing + session engine).
- `packages/db`: migrations + repository layer on top of Postgres/pg-mem.
- `packages/config`: shared config/util package.

Rule of thumb: domain logic stays in `chess-core`; transport and storage remain in `apps/*` and `packages/db`.

## Runtime Components

### Web App (`apps/web`)

- Owns UI state, board interactions, autoplay animation, local preferences, and optional browser-side Stockfish eval.
- Calls API endpoints in `apps/web/src/lib/api.ts`.
- Renders board via Chessground and overlays custom behavior (promotion UI, hints, wrong-move marker, in-board coordinates).

### API App (`apps/api`)

- Exposes `/api/v1/session/*` endpoints.
- Ensures anonymous session identity via cookie middleware.
- Applies route-level rate limits before session actions.
- Delegates puzzle/session orchestration to `SessionService`.

### Domain Engine (`packages/chess-core`)

- `parsePuzzlePgn`: converts PGN + variations into normalized node graph.
- `PuzzleSessionEngine`: executes user moves, hint/reveal/skip flow, variation traversal, autoplay and rewind metadata.
- Contains no HTTP, DB, or framework dependencies.

### Database Layer (`packages/db`)

- Runs migrations.
- Provides repositories for puzzles, sessions, and rate-limit events.
- Implements indexed random puzzle selection (`random_bucket`, `random_key`) rather than expensive full-table random order.

## Request/Data Flow (High Level)

1. Browser calls API endpoint with `credentials: include`.
2. API validates payload (Zod), enforces rate limits, ensures anon session cookie.
3. `SessionService` loads puzzle/session context and invokes `PuzzleSessionEngine`.
4. Service persists updated cursor/session counters in DB.
5. API returns normalized response payload to UI.
6. UI applies optimistic/animated transitions and updates side panels/history.

## Session Model (Conceptual)

- A puzzle is a rooted move tree (`puzzle_nodes`) with actor labels (`user` or `opponent`) and mainline metadata.
- A puzzle session tracks:
  - current node id
  - branch cursor (`lineIndex`, `cursorIndex`)
  - status flags (`solved`, `revealed`, `autoplay_used`)
  - behavior counters (wrong moves, hints)
- In `explore` mode, user-side branches are traversed; in `mainline`, only mainline continuation is followed.

## Operational Notes

- API starts on a configured Postgres URL; if unavailable in local development it falls back to `pg-mem`.
- Daily metrics are incremented on key events (`puzzles_started`, `puzzles_solved`, `hint_used`, `reveal_used`).
- Security baseline includes CSP headers, strict cookies, and per-route abuse controls.
