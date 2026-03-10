## Puzzle History + Hint Arrow + Hover + Right Eval + TODO Update

### Summary
- Implement Lichess-style clickable past-puzzle logs under the board, with 3 outcome states: `Correct`, `Half-correct`, `Incorrect`.
- Add 2-step hint escalation: first click highlights the piece, second click adds a teaching arrow.
- Make toggle-chip hover much stronger (desktop hover only).
- Show live engine evaluation text in the right panel header.
- Update `TODO.md` to reflect these features.

### Key Implementation Changes
- **Backend/API**
  - Add DB migration for `puzzle_sessions` counters:
    - `wrong_move_count int not null default 0`
    - `hint_count int not null default 0`
  - Extend DB session types/repo mapping to include counters + `created_at`.
  - Update session write paths:
    - `playMove`: increment `wrong_move_count` on incorrect moves.
    - `hint`: increment `hint_count` when a hint is served.
  - Extend hint response contract with `bestMoveUci` (nullable) so frontend can draw arrow.
  - Add `POST /api/v1/session/history` with `{ limit?: number }` (default `20`, max `50`), scoped to current anon cookie session.
  - Return history items with: session id, puzzle public id/title, timestamp, derived status, and counters needed for UI/debug.

- **Status derivation (decision-complete)**
  - `Correct`: solved, not revealed, `wrong_move_count = 0`, `hint_count = 0`
  - `Half-correct`: solved, not revealed, and (`wrong_move_count > 0` or `hint_count > 0`)
  - `Incorrect`: revealed or unsolved

- **Frontend**
  - Add history fetch in API client/types and state in `App`.
  - Render history **under board** as clickable compact log items (horizontal/scrollable).
  - Clicking a history item starts a **fresh session** for that puzzle id (not resume).
  - Add hint UI state:
    - Track per-puzzle `hintLevel` (`0/1/2`), reset on puzzle change/reveal/success transitions.
    - Level 1: piece highlight only.
    - Level 2+: piece highlight + arrow from `bestMoveUci`.
  - Extend `ChessBoard` props with `hintArrow` and render both circle + arrow via `drawable.autoShapes`.
  - Add right-panel engine line (e.g. `Engine: +0.34`, `M3`, or unavailable), updated from `useStockfishEval`.
  - Strengthen `.toggle-chip:hover` interaction (bigger lift/scale/shadow), guarded with `@media (hover: hover)`.

- **TODO list**
  - Update `TODO.md` to add/mark complete items for:
    - clickable puzzle history logs with 3-state result tags,
    - stronger toggle-chip hover,
    - hint escalation with arrow,
    - right-panel engine evaluation display.

### Public API / Type Changes
- `HintResponse` adds `bestMoveUci: string | null`.
- New history endpoint response:
  - `items: Array<{ sessionId, puzzlePublicId, puzzleTitle, createdAt, status: 'correct'|'half'|'incorrect', wrongMoveCount, hintCount, revealed, solved }>`.

### Test Plan
- **API/service tests**
  - History status classification for all 3 statuses.
  - Hint endpoint includes `bestMoveUci` when available.
  - History ordering is newest-first and respects `limit`.
- **Frontend tests (or smoke if no harness)**
  - Hint click 1 shows piece marker only; click 2 adds arrow.
  - Clicking history item loads that puzzle as new session.
  - Engine text appears in right panel and updates with eval changes.
  - Toggle-chip hover style visibly larger on desktop hover.
- **Validation**
  - Run `pnpm -r typecheck`, `pnpm -r test`, and targeted UI smoke run.

### Assumptions
- Existing uncommitted edits in `App.tsx`, `ChessBoard.tsx`, `styles.css`, and sound assets are intentional and must be preserved.
- History scope is current anonymous cookie session only.
- “Half-correct” means solved with assistance/mistake; reveal counts as incorrect.
