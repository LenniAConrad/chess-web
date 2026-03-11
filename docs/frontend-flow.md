# Frontend Flow

## Entry and Composition

- Entry point: `apps/web/src/main.tsx`.
- Root component: `apps/web/src/App.tsx`.
- Board UI: `apps/web/src/components/ChessBoard.tsx`.
- Engine eval bar: `apps/web/src/components/EvalBar.tsx`.

`App` owns the full puzzle UI state and orchestrates all API calls.

## Major State Groups in `App`

- Session identity and puzzle context (`sessionId`, `puzzle`, `state`, `displayFen`).
- Interaction status (`loading`, `historyLoading`, `statusText`, `errorText`, `correctText`).
- Board overlays (`lastMoveSquares`, `hintSquare`, `hintArrow`, wrong-move marker).
- Review/history (`historyItems`, `sessionTree`, `reviewPath`).
- Preferences (`useLocalPrefs`) for autoplay, sound, variation mode, etc.

## Move Flow (User Action)

1. User move arrives from `ChessBoard` callback.
2. App computes optimistic FEN and optional sound decision.
3. App calls `playMove`.
4. Depending on result:
  - `incorrect`: temporary marker/feedback, then revert to authoritative state.
  - `correct`: show success status, run autoplay animation if needed.
  - `completed`: finalize branch and optionally auto-load next puzzle.
5. App refreshes history/tree artifacts.

## Autoplay and Animation

`animateAutoPlay` in `App.tsx` applies backend-provided metadata:

- `rewindFens`: animate rewinding to branch split.
- `autoPlayStartFen`: base position before opponent sequence.
- `autoPlayedMoves`: animate opponent continuation.

Animation timing is gated by preference flags and shortened when animations are disabled.

## Board Integration Details

`ChessBoard.tsx` wraps Chessground with custom behavior:

- legal move destinations from current FEN
- promotion chooser (manual vs auto-queen preference)
- premove handling for non-user turns
- hint arrow/square overlays
- wrong move indicator
- in-board coordinates overlay

Chessground coordinates are disabled and replaced by custom in-board labels to match board texture and orientation handling.

## Network Layer

`apps/web/src/lib/api.ts` is the single API client surface:

- all calls use `credentials: include` for anon session cookie continuity
- errors are normalized by throwing response text/status
- response types are shared via `apps/web/src/types/api.ts`
