export type VariationMode = 'explore' | 'mainline';
export type MoveActor = 'user' | 'opponent';
export type SessionStepResult = 'correct' | 'incorrect' | 'completed';

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

export interface ParsedPuzzle {
  title: string;
  source: string;
  startFen: string;
  rootNode: PuzzleNode;
  nodes: PuzzleNode[];
}

export interface SessionCursor {
  lineIndex: number;
  cursorIndex: number;
}

export interface SessionState {
  puzzleId: number;
  currentNodeId: number;
  mode: VariationMode;
  branchCursor: Record<string, number>;
  completedBranches: string[];
  solved: boolean;
  revealed: boolean;
}

export interface SessionSnapshot {
  nodeId: number;
  fen: string;
  toMove: 'w' | 'b';
  variationMode: VariationMode;
  lineIndex: number;
  totalLines: number;
  completedBranches: number;
}

export interface MoveResponse {
  result: SessionStepResult;
  expectedBestMoveUci?: string;
  autoPlayedMoves: string[];
  autoPlayStartFen?: string | null;
  rewindFens?: string[];
  snapshot: SessionSnapshot;
}
