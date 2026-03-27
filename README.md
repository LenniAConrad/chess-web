# chess-web

<p align="center">
  <img
    src="assets/app-icon.svg"
    alt="Chess Puzzle Trainer app icon"
    width="128"
  />
</p>

No-account chess puzzle trainer built as a `pnpm` monorepo. It serves PGN-based tactical puzzles with variation trees, validates moves on the server, keeps recent-session history, and adds optional browser-side Stockfish evaluation for replay and study.

## Highlights

- PGN puzzle import with full variation-tree support
- Server-side move validation and session orchestration
- Explore and mainline solving modes
- Puzzle history with replay, tree review, and direct loading by public ID
- Optional autoplay, auto-next, one-try mode, hints, reveal, skip variation, and auto-queen
- Browser Stockfish eval bar and local UI preferences
- Multilingual UI with native-language labels and RTL handling
- Local Postgres support with `pg-mem` fallback for lightweight development

## Screenshots

### Light Mode

<img
  src="assets/light-mode.png"
  alt="Chess Puzzle Trainer in light mode with the board on the left and the control rail on the right"
  width="100%"
/>

### Dark Mode

<img
  src="assets/dark-mode.png"
  alt="Chess Puzzle Trainer in dark mode with the board on the left and the control rail on the right"
  width="100%"
/>

### Zen Mode

<img
  src="assets/zen-mode.png"
  alt="Chess Puzzle Trainer in zen mode with the gameplay area focused and chrome hidden"
  width="100%"
/>

## Stack

- Frontend: React, Vite, TypeScript, Chessground
- Backend: Fastify, TypeScript, Postgres
- Shared domain logic: `packages/chess-core`
- Database layer: `packages/db`
- Shared config/helpers: `packages/config`
- Workspace tooling: `pnpm`

## Repo Layout

- `apps/web`: React client
- `apps/api`: Fastify API
- `packages/chess-core`: PGN parsing and puzzle/session engine logic
- `packages/db`: migrations, repositories, DB client
- `packages/config`: shared env/config helpers
- `docs`: architecture and flow documentation
- `ops`: deployment and operations notes
- `assets`: screenshots and app icon

## Quick Start

1. Copy the example env file:

```bash
cp .env.example .env
```

2. For zero-setup local development, set this in `.env`:

```bash
DATABASE_URL=pgmem://local
```

3. Install dependencies:

```bash
npx pnpm@10.5.2 install
```

4. Start both apps:

```bash
./start.sh
```

Default local URLs:

- Web: `http://localhost:5173`
- API: `http://localhost:3001`
- Health check: `http://localhost:3001/health`

`start.sh` waits for both services to become reachable and stops them together on `Ctrl+C`.

## Environment Notes

The example env file includes the main runtime settings:

- `API_PORT`, `API_HOST`
- `VITE_API_BASE_URL`
- `DATABASE_URL`
- `COOKIE_SECRET`
- `ALLOWED_ORIGINS`
- `IMPORT_TOKEN`
- `SEED_PGN_FILE`
- `SEED_MAX_PUZZLES`

In non-production mode, if the configured Postgres database is unavailable, the API falls back to in-memory `pg-mem`.

## Database And Puzzle Import

The API can run against either:

- Postgres via `DATABASE_URL`
- in-memory `pgmem://local` for development

Run migrations manually:

```bash
npx pnpm@10.5.2 --filter @chess-web/api migrate
```

Import a PGN file from the CLI:

```bash
npx pnpm@10.5.2 --filter @chess-web/api import:pgn -- --file /path/to/puzzles.pgn --token "$IMPORT_TOKEN"
```

Bundled puzzle data also exists at `puzzle_exports/stack_min_2plies_256k.pgn`.

If `SEED_PGN_FILE` is set and the puzzle table is empty, the API can seed puzzles automatically on startup.

## Useful Commands

From the repo root:

```bash
npx pnpm@10.5.2 -r typecheck
npx pnpm@10.5.2 -r lint
npx pnpm@10.5.2 -r test
npx pnpm@10.5.2 -r build
```

Or run the helper build script:

```bash
./build.sh
```

Run apps separately:

```bash
npx pnpm@10.5.2 --filter @chess-web/api dev
npx pnpm@10.5.2 --filter @chess-web/web dev
```

## API Surface

Session routes:

- `POST /api/v1/session/start`
- `POST /api/v1/session/load`
- `POST /api/v1/session/move`
- `POST /api/v1/session/hint`
- `POST /api/v1/session/reveal`
- `POST /api/v1/session/skip-variation`
- `POST /api/v1/session/next`
- `POST /api/v1/session/prefetch-next`
- `POST /api/v1/session/history`
- `POST /api/v1/session/history/clear`
- `POST /api/v1/session/tree`

Puzzle and admin routes:

- `GET /api/v1/puzzles/count`
- `GET /api/v1/admin/import-status`
- `POST /api/v1/admin/import-bundled`
- `GET /api/v1/puzzles/:publicId/tree` in non-production debug mode
- `GET /health`

The admin import routes require `x-import-token` to match `IMPORT_TOKEN`.

## Documentation

- [docs/README.md](docs/README.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/api-and-session-flow.md](docs/api-and-session-flow.md)
- [docs/frontend-flow.md](docs/frontend-flow.md)
- [docs/database-model.md](docs/database-model.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)

## Licensing

- Repository licenses: [LICENSE](LICENSE), [LICENSE.txt](LICENSE.txt)
- Piece asset notice: `apps/web/public/pieces/cburnett/NOTICE.txt`
- Sound pack notices:
  - `apps/web/public/sounds/lichess-standard/LICENSE.txt`
  - `apps/web/public/sounds/lichess-sfx/LICENSE.txt`
- Curated runtime dependency notices: [THIRD_PARTY_LICENSES.json](THIRD_PARTY_LICENSES.json)

Regenerate the curated runtime notice file with:

```bash
node scripts/generateThirdPartyLicenses.mjs
```

## Notes

- Browser-side anti-download prevention is only best-effort.
- The app uses rate limiting and avoids bulk export-style puzzle endpoints.
- The default runtime audio pack is `lichess-standard`.
- Deployment notes live in [ops/oracle-cloudflare.md](ops/oracle-cloudflare.md).
