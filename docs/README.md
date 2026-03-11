# Chess Puzzle Web Docs

This folder is the detailed technical documentation for the monorepo.
If you are new to the codebase, start with the architecture page and then follow the app-specific pages.

## Start Here

- [Architecture](./architecture.md): monorepo boundaries, runtime components, and request/data flow.
- [API and Session Flow](./api-and-session-flow.md): endpoint contracts and the puzzle session lifecycle.
- [Frontend Flow](./frontend-flow.md): how the React app state and board interactions are coordinated.
- [Database Model](./database-model.md): schema, indexes, and random puzzle selection strategy.

## Source Anchors

- Core puzzle engine: `packages/chess-core/src/engine.ts`
- PGN import/parser: `packages/chess-core/src/pgn.ts`
- Session orchestration: `apps/api/src/services/sessionService.ts`
- HTTP routes: `apps/api/src/routes/session.ts`
- Puzzle/session repositories: `packages/db/src/repositories/*.ts`
