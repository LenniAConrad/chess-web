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
