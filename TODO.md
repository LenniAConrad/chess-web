# Chess Puzzle Site TODO

## 0) Scope and constraints
- [x] Confirm MVP scope: no auth, no accounts, no signup (anonymous cookie session only)
- [x] Confirm puzzle format: PGN + optional `SetUp`/`FEN` + variations
- [ ] Confirm dependency budget and approved libraries
- [x] Confirm monorepo strategy: `pnpm` workspaces (`apps/*` + `packages/*`)
- [x] Enforce file-size rule: max `2000` lines per source file
- [x] Add lint rule for `max-lines` and fail CI on violations
- [x] Add architecture guardrail doc with allowed module boundaries

## 0.3) Confirmed product decisions (2026-03-05)
- [x] Target users: chess enthusiasts of all levels
- [x] Primary KPIs: daily active users, puzzles solved, time on site
- [x] Puzzle rights: own PGN content
- [x] Solver rule: exactly one correct move per player turn
- [x] Variation rule: multiple opponent responses allowed from PGN branches
- [x] Default mode: `Explore variations` ON
- [x] Anti-abuse target: strict posture; block obvious scraping bursts (e.g. >3 puzzle fetches/sec/IP)
- [x] Engine mode: Stockfish eval runs in browser (client-side)
- [x] Launch corpus target: ~2,000,000 puzzles
- [x] Wrong move behavior: unlimited retries + optional "Show solution"
- [x] Hints: enabled (start with piece-highlight hint)
- [x] Puzzle progression: auto-load next puzzle by default (toggleable)
- [x] Launch browse mode: random puzzles only (no filters initially)
- [x] Early scale expectation: ~1,000 DAU (niche launch)

## 0.4) Infra decisions (current implementation)
- [x] Hosting model selected for now: Cloudflare Pages (web) + Oracle VM (API/Postgres)
- [x] Admin workflow at launch: CLI-only PGN import (no admin page)

## 0.1) Security requirements (must-have)
- [x] Define threat model baseline (XSS, injection, scraping, abuse, DoS) in architecture docs
- [x] Add strict input validation on every API endpoint (`zod`/schema validation)
- [x] Use parameterized SQL only (no string-built queries)
- [x] Add secure HTTP headers (CSP, HSTS, X-Content-Type-Options, frame-ancestors)
- [x] Add API rate limiting and abuse throttling per IP/session
- [x] Lock CORS to configured allowlisted origin(s)
- [x] Add request logging + audit trail for import/admin actions
- [x] Add dependency auditing (`pnpm audit` + CI gate)
- [ ] Add SAST + secret scanning in CI

## 0.2) Puzzle protection / anti-download (best effort)
- [x] Document limitation: complete prevention is impossible once puzzle is playable in browser
- [x] Do not expose bulk dump endpoints for puzzle content
- [x] Serve puzzle data one puzzle/session at a time from API
- [x] Return only current node context by default; tree endpoint is debug-only (non-production)
- [x] Gate next variation/path behind server-validated session progression
- [x] Add aggressive rate limits for sequential puzzle fetches
- [x] Add bot heuristics and temporary bans for scraper behavior
- [x] Add escalating penalties (cooldown -> temporary block -> longer block)
- [ ] Add watermark/honeypot puzzle IDs to detect leaked dumps
- [ ] Minify/obfuscate client bundle only as soft friction (not true security)

## 1) Project setup
- [x] Initialize frontend app (`React + Vite + TypeScript`) in `apps/web`
- [x] Initialize backend API (`Fastify + TypeScript`) in `apps/api`
- [x] Initialize shared packages: `packages/chess-core`, `packages/db`, `packages/config` (`packages/ui` deferred)
- [x] Add shared lint/format/test scripts
- [x] Add `.env.example` and basic config docs
- [x] Add root scripts for `dev`, `build`, `test`, `lint`, `typecheck`, `audit`

## 2) Core dependencies
- [x] Add `chess.js` for move legality and position updates
- [x] Add PGN parser with variation support (`@mliebelt/pgn-parser`)
- [x] Add board UI library (`chessground` or equivalent)
- [x] Add Stockfish worker package (WASM)
- [ ] Keep total dependency count minimal and documented
- [x] Keep pure puzzle logic in shared packages; app-specific runtime concerns stay in app packages
- [ ] Add dependency boundary checks (no `apps/*` imports inside `packages/*`)

## 3) Database and schema
- [x] Use production-first Postgres schema with in-memory `pg-mem` fallback for local/dev
- [x] Local/dev fallback: in-memory `pg-mem` (SQLite not used in current implementation)
- [x] Production: Postgres for large scale + concurrent reads
- [x] Create `puzzles` table (`id`, `public_id`, `title`, `start_fen`, `source`, random keys, timestamps)
- [x] Create `puzzle_nodes` table for parsed move tree (`parent_id`, `ply`, `san`, `uci`, `fen_after`, `is_mainline`, `sibling_order`, `actor`)
- [ ] Create optional `puzzle_tags` table for lookup
- [ ] Create optional `node_eval` cache table
- [x] Add indexes for puzzle search and random selection
- [x] Add precomputed random key column/index to avoid slow `ORDER BY random()` at 2M scale
- [ ] Add cursor-based pagination for search endpoints

## 4) PGN import and parsing
- [x] Build PGN import pipeline (CLI file import + seed path + built-in sample text)
- [x] Parse PGN into normalized move tree with stable node IDs
- [x] Validate FEN start position and move legality
- [ ] Persist both original PGN text and parsed nodes
- [ ] Add import error reporting with line/context details
- [x] Protect import workflow with admin secret/token (`IMPORT_TOKEN`) and keep it non-public

## 5) Puzzle session engine
- [x] Build traversal engine that runs from current node + board state
- [x] Enforce user guess = mainline best move at player turns
- [x] Auto-play opponent response after correct guess
- [x] Implement variation exploration mode
- [x] Run each opponent child branch one by one
- [x] Rewind to branch start between branches
- [x] Mark branch completion and continue until all done
- [x] Implement mainline-only mode toggle
- [x] Implement skip-current-variation action

## 6) API endpoints
- [x] `POST /api/v1/session/start`
- [x] `POST /api/v1/session/move`
- [x] `POST /api/v1/session/hint`
- [x] `POST /api/v1/session/reveal`
- [x] `POST /api/v1/session/skip-variation`
- [x] `POST /api/v1/session/next`
- [x] `GET /api/v1/puzzles/:publicId/tree` for debug/tooling (non-production only)
- [x] `GET /health`
- [x] Import path implemented as CLI command (`import:pgn`), not public HTTP endpoint
- [x] Defer search/filter endpoints until post-MVP
- [x] Add versioned API namespace (`/api/v1/*`)
- [x] Add per-IP rate limits tuned for puzzle fetches (start route currently targets 3 req/s burst)

## 7) Frontend UX
- [x] Render board from FEN with legal drag/click moves
- [x] Show puzzle prompt and turn state (`Your move`, `Correct`, `Try again`)
- [ ] Show move list with current node highlight
- [x] Add controls: `Explore variations` (toggle to mainline), `Skip variation`, `Next puzzle`, `Show solution`, `Hint`
- [ ] Add `Replay` control
- [x] Add hint behavior v1: highlight candidate piece for best move
- [x] Add unlimited retry loop until solved or user reveals solution
- [x] Add auto-next default ON + user setting toggle
- [ ] Add simple local progress persistence (`localStorage`)
- [x] Persist user preferences (auto-next, variation mode, hints) in `localStorage`
- [x] Add responsive layout for desktop and mobile

## 8) Stockfish integration
- [x] Run Stockfish in Web Worker
- [x] Evaluate current position after each move
- [x] Show eval bar (cp/mate) with engine depth indicator
- [x] Increase browser Stockfish target search depth to `25`
- [x] Add Lichess-style eval guide lines/ticks on eval bar
- [x] Fix eval fill rendering so vertical bar uses full width and mobile horizontal bar uses full height
- [x] Throttle/cancel stale evaluations on fast move changes
- [x] Add fallback behavior if engine fails or is unavailable

## 9) Testing
- [x] Unit tests for PGN parsing and tree building
- [ ] Unit tests for branch traversal and rewind logic
- [x] Unit tests for move validation (correct/incorrect guess)
- [ ] Integration tests for key API endpoints
- [ ] E2E smoke test: load puzzle -> solve -> explore variations
- [ ] Security tests: basic injection/XSS/abuse regression suite
- [ ] Add load test for puzzle fetch + move validation endpoints

## 10) Seed data and operations
- [ ] Add initial launch import for ~2,000,000 puzzles
- [ ] Keep a small sample pack (20-50) for local development and CI tests
- [x] Build import script for batch PGN ingestion
- [ ] Add backup/export script for Postgres (SQLite plan replaced)
- [x] Add basic observability logs for API and import failures
- [ ] Add rotating backups and restore drill checklist

## 10.1) Analytics
- [x] Track DAU (anonymous session-based)
- [x] Track puzzles solved per day and per session
- [x] Track session duration / average time on site
- [ ] Add lightweight dashboard or SQL views for KPI monitoring
- [ ] Add anti-abuse metrics dashboard (rate-limit hits, blocked IPs, suspicious sessions)

## 11) Release
- [x] Create production build configs
- [x] Deploy API + static frontend plan/docs
- [ ] Verify Web Worker/Stockfish works in production
- [ ] Run final QA checklist across browsers
- [ ] Run security checklist before each release
- [ ] Run dependency and container/image scans before deployment

## 12) Nice-to-have (post-MVP)
- [ ] Puzzle difficulty estimation from engine/error rate
- [ ] Thematic tags (fork, pin, mate, endgame)
- [ ] Daily puzzle endpoint
- [ ] Lightweight admin page for PGN upload and validation
