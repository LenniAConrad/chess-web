/**
 * Branch traversal mode:
 * - `explore`: include variation branches for user-side decisions.
 * - `mainline`: follow mainline-only continuation.
 */
export type VariationMode = 'explore' | 'mainline';
export type MoveActor = 'user' | 'opponent';
export type SessionStepResult = 'correct' | 'incorrect' | 'completed';

/** Normalized puzzle tree node used by the session engine. */
export interface PuzzleNode {
  id: number;
  parentId: number | null;
  ply: number;
  san: string;
  uci: string;
  actor: MoveActor;
  isMainline: boolean;
  siblingOrder: number;
  fenAfter: string;
}

/** Parsed PGN payload prepared for persistence/import. */
export interface ParsedPuzzle {
  title: string;
  source: string;
  startFen: string;
  rootNode: PuzzleNode;
  nodes: PuzzleNode[];
}

/** Cursor pointing to the active line and index inside that line. */
export interface SessionCursor {
  lineIndex: number;
  cursorIndex: number;
}

/**
 * Legacy persisted session shape used by older storage code paths.
 * (Current API payload uses SessionSnapshot/SessionStatePayload).
 */
export interface SessionState {
  puzzleId: number;
  currentNodeId: number;
  mode: VariationMode;
  branchCursor: Record<string, number>;
  completedBranches: string[];
  solved: boolean;
  revealed: boolean;
}

/** UI-ready immutable snapshot of the current engine state. */
export interface SessionSnapshot {
  nodeId: number;
  fen: string;
  toMove: 'w' | 'b';
  variationMode: VariationMode;
  lineIndex: number;
  totalLines: number;
  completedBranches: number;
}

/** Move execution outcome including autoplay/rewind metadata. */
export interface MoveResponse {
  result: SessionStepResult;
  expectedBestMoveUci?: string;
  autoPlayedMoves: string[];
  autoPlayStartFen?: string | null;
  rewindFens?: string[];
  snapshot: SessionSnapshot;
}
