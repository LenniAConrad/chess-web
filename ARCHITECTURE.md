# Architecture Guardrails

## Goals
- Keep implementation simple and secure.
- Keep files maintainable: hard cap of `2000` lines per source file.
- Keep dependencies clean through clear package boundaries.
- Support launch scale of ~2,000,000 puzzles without redesign.

## Repository layout
```text
chess-web/
  apps/
    web/            # React frontend
    api/            # Fastify backend
  packages/
    chess-core/     # PGN parsing, tree traversal, puzzle session logic
    db/             # SQLite schema, migrations, query layer
    config/         # shared tsconfig/eslint/prettier/zod/env helpers
    ui/             # optional shared UI components
  ARCHITECTURE.md
```

## Dependency policy
- `apps/web` may depend on `packages/chess-core`, `packages/config`, optional `packages/ui`.
- `apps/api` may depend on `packages/chess-core`, `packages/db`, `packages/config`.
- `packages/*` must not import from `apps/*`.
- `packages/chess-core` must stay framework-agnostic and database-agnostic.
- Runtime dependencies belong to the smallest possible package scope.
- Prefer fewer libraries and explicit wrappers over many direct package imports.

## Data and scale policy
- Local/dev database: SQLite (fast setup, low overhead).
- Production database: Postgres (better concurrency and ops at 2M records).
- Do not use `ORDER BY random()` for puzzle selection at scale.
- Use indexed random key / bucket strategy for fast random fetch.
- Keep import pipeline idempotent and resumable for bulk PGN ingestion.

## Security baseline
- Validate all API input with schemas.
- Use parameterized queries only.
- Enforce CSP + secure headers.
- Add rate limiting and abuse controls.
- Keep admin import endpoints protected by secret/token.

## Puzzle access hardening
- No bulk export endpoints.
- Serve puzzles per-session/per-request with strict limits.
- Optionally send partial tree data (progressive reveal) instead of full tree.
- Track suspicious fetch patterns and throttle/ban.
- Start rate-limit policy around puzzle fetch bursts (example: >3 req/sec/IP).
- Use escalation policy: cooldown, short ban, longer repeat-offender ban.
- Note: full prevention of downloading is impossible once data is rendered client-side.

## Product behavior constraints
- Exactly one correct user move per player turn.
- Opponent can have multiple PGN responses (variations).
- `Explore variations` is the default mode.
- Wrong moves allow unlimited retries.
- User can request `Show solution`.
- Hint system v1 highlights the candidate piece.
- Auto-next puzzle is enabled by default and can be turned off.
- Stockfish evaluation runs client-side in a Web Worker.

## Maintainability rules
- `max-lines`: 2000 per file (lint + CI enforced).
- Prefer modules in the 100-400 line range.
- Public API surface for each package in a single `index.ts`.
- Keep pure domain logic in `packages/chess-core`; UI and transport stay in apps.

## Build and quality gates
- Required checks in CI: `lint`, `typecheck`, `test`, `audit`.
- Security checks: dependency audit + secret scanning + basic SAST.
- Block merge when any required check fails.
