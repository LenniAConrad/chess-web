export type VariationMode = 'explore' | 'mainline';

export interface SessionStatePayload {
  nodeId: number;
  fen: string;
  toMove: 'w' | 'b';
  variationMode: VariationMode;
  lineIndex: number;
  totalLines: number;
  completedBranches: number;
}

export interface StartSessionResponse {
  sessionId: string;
  puzzle: {
    publicId: string;
    startFen: string;
    title: string;
  };
  state: SessionStatePayload;
  ui: {
    autoNextDefault: boolean;
  };
}

export interface MoveResponse {
  result: 'correct' | 'incorrect' | 'completed';
  bestMoveUci?: string;
  autoPlayedMoves: string[];
  autoPlayStartFen: string | null;
  rewindFens: string[];
  nextState: SessionStatePayload;
  completedBranches: number;
  totalBranches: number;
}

export interface HintResponse {
  pieceFromSquare: string | null;
  bestMoveUci: string | null;
  state: SessionStatePayload;
}

export interface RevealResponse {
  bestMoveUci: string | null;
  bestMoveSan: string | null;
  afterFen: string | null;
  autoPlayedMoves: string[];
  autoPlayStartFen: string | null;
  rewindFens: string[];
  nextState: SessionStatePayload;
}

export interface SkipVariationResponse {
  skipped: boolean;
  autoPlayedMoves: string[];
  autoPlayStartFen: string | null;
  rewindFens: string[];
  nextState: SessionStatePayload;
  remainingBranches: number;
}

export interface NextResponse {
  newSessionId: string;
  puzzle: {
    publicId: string;
    startFen: string;
    title: string;
  };
  state: SessionStatePayload;
}

export type SessionHistoryStatus = 'correct' | 'half' | 'incorrect';

export interface SessionHistoryItem {
  sessionId: string;
  puzzlePublicId: string;
  puzzleTitle: string;
  createdAt: string;
  status: SessionHistoryStatus;
  autoplayUsed: boolean;
  wrongMoveCount: number;
  hintCount: number;
  solved: boolean;
  revealed: boolean;
}

export interface SessionHistoryResponse {
  items: SessionHistoryItem[];
}

export interface SessionHistoryClearResponse {
  cleared: number;
}

export interface SessionTreeNode {
  id: number;
  parent_id: number | null;
  ply: number;
  san: string;
  uci: string;
  fen_after: string;
  is_mainline: boolean;
  sibling_order: number;
  actor: 'user' | 'opponent';
}

export interface SessionTreeResponse {
  puzzle: {
    publicId: string;
    title: string;
    startFen: string;
  };
  currentNodeId: number;
  nodes: SessionTreeNode[];
}
