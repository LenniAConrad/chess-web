# Chess Puzzle Web

No-account chess puzzle trainer with PGN variation support, server-side move validation, browser Stockfish eval, and random puzzle delivery.

## Stack

- Monorepo: `pnpm` workspaces
- Frontend: React + Vite + TypeScript (`apps/web`)
- Backend: Fastify + TypeScript + Postgres (`apps/api`)
- Shared domain logic: `packages/chess-core`
- DB schema/repositories: `packages/db`

## Quick Start

1. Copy env:

```bash
cp .env.example .env
```

2. Install dependencies:

```bash
npx pnpm@10.5.2 install
```

3. Run migrations:

```bash
npx pnpm@10.5.2 --filter @chess-web/api migrate
```

4. Import PGN puzzles:

```bash
npx pnpm@10.5.2 --filter @chess-web/api import:pgn -- --file /path/to/puzzles.pgn --token "$IMPORT_TOKEN"
```

5. Run both apps in one terminal:

```bash
./start.sh
```

Optional manual mode:

```bash
npx pnpm@10.5.2 --filter @chess-web/api dev
npx pnpm@10.5.2 --filter @chess-web/web dev
```

- API: `http://localhost:3001`
- Web: `http://localhost:5173`

## Scripts

From repo root:

```bash
npx pnpm@10.5.2 -r typecheck
npx pnpm@10.5.2 -r lint
npx pnpm@10.5.2 -r test
npx pnpm@10.5.2 -r build
```

## API (MVP)

- `POST /api/v1/session/start`
- `POST /api/v1/session/move`
- `POST /api/v1/session/hint`
- `POST /api/v1/session/reveal`
- `POST /api/v1/session/skip-variation`
- `POST /api/v1/session/next`
- `GET /health`

## Notes

- Full anti-download prevention is impossible in browsers; this app uses best-effort hardening (rate limits, per-session fetch, no bulk endpoints).
- File-size limit is enforced in ESLint (`max-lines <= 2000`).
- Launch deployment target docs: [ops/oracle-cloudflare.md](ops/oracle-cloudflare.md)
