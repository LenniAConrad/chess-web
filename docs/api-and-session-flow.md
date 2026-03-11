# API and Session Flow

## Endpoint Summary

All endpoints are under `/api/v1/session` and use JSON payloads.

| Endpoint | Purpose |
| --- | --- |
| `POST /start` | Start random puzzle session or explicit puzzle id session. |
| `POST /move` | Submit user move (`uciMove`) for validation/progression. |
| `POST /hint` | Request next-best move hint metadata. |
| `POST /reveal` | Reveal best move and continue autoplay branch progression. |
| `POST /skip-variation` | Skip current variation branch and continue with next branch. |
| `POST /next` | Load next puzzle session (optionally reusing untouched session). |
| `POST /load` | Load an existing session from history. |
| `POST /history` | Fetch recent session history for the anon user. |
| `POST /history/clear` | Clear history while keeping the current session. |
| `POST /tree` | Fetch puzzle tree nodes and current node for explorer/review. |

## Request Handling Pipeline

Each route follows the same pipeline:

1. Parse/validate request body with Zod schema.
2. Ensure anonymous session identity cookie is present.
3. Enforce route-specific rate limits.
4. Call `SessionService` operation.
5. Return normalized response payload.

Not-found style errors are surfaced as `404`, payload validation as `400`, and unexpected errors as `500`.

## Session Lifecycle

### 1) Start

- `startRandomSession` or `startSessionByPublicId` creates:
  - `puzzle_sessions` row
  - initial branch cursor (`lineIndex=0`, `cursorIndex=0`)
  - initial `SessionStatePayload`
- API returns puzzle header + state + UI defaults.

### 2) Play Move

- Service loads full context (`session`, `puzzle`, `nodes`) and constructs engine.
- Engine compares `uciMove` against expected best continuation.
- Result can be:
  - `incorrect`: cursor unchanged; expected move returned.
  - `correct`: cursor advances and may trigger opponent autoplay.
  - `completed`: final branch solved.
- Session counters and flags persist after every move.

### 3) Hint / Reveal / Skip

- `hint`: returns source square + best move candidate; increments hint counter when used.
- `reveal`: forces best move progression, marks `revealed = true`, records autoplay usage when source is `auto`.
- `skipVariation`: jumps to next branch in explore mode with rewind/autoplay metadata.

### 4) Next Puzzle

- If `autoNext` is enabled, the service first tries to resume the oldest untouched puzzle session.
- Otherwise starts a new random puzzle excluding current puzzle id where possible.

## State Payload Semantics

`SessionStatePayload` drives frontend rendering:

- `nodeId`: currently displayed node in the tree.
- `fen` / `toMove`: board position and side-to-move.
- `variationMode`: `explore` or `mainline`.
- `lineIndex` / `totalLines`: active branch and branch count.
- `completedBranches`: progress indicator used in status UI.

## Variation Modes

- `mainline`: always follows mainline continuation for non-user turns and branch generation.
- `explore`: exposes variation branches for the user side and allows branch skipping/traversal.
