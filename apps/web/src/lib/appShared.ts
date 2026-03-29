import type { CSSProperties } from 'react';
import { Chess, type PieceSymbol, type Square } from 'chess.js';
import type { HistoryDotTone } from './historyDots.js';
import type { FrontendI18n } from './i18n.js';
import { playMoveSound, type MoveSoundType } from './moveSounds.js';
import type { SessionStatePayload, StartSessionResponse } from '../types/api.js';

export interface PuzzleHeader {
  publicId: string;
  startFen: string;
  title: string;
}

export const AUTO_PLAY_DELAY_MS = 220;
export const CORRECT_BREAK_MS = 220;
export const REWIND_STEP_DELAY_MS = 220;
export const REWIND_BREAK_MS = 160;
export const SHORT_STATUS_DELAY_MS = 160;
const CHECK_SOUND_DELAY_MS = 0;
export const WRONG_MOVE_FEEDBACK_MS = 220;
export const SESSION_HISTORY_FETCH_LIMIT = 100;
export const NO_ANIMATION_DELAY_MS = 120;
export const MOBILE_HISTORY_PREVIEW_HOLD_MS = 260;
export const CAPTURE_RAIN_MAX_PIECES = 64;
export const REPO_URL = 'https://github.com/LenniAConrad/chess-web';
export const HISTORY_PREVIEW_DELAY_MS = 110;

type PrimaryMoveSoundType = Exclude<MoveSoundType, 'check'>;

export interface MoveSoundDecision {
  primary: PrimaryMoveSoundType | null;
  isCheck: boolean;
}

export interface AppChromeLink {
  href: string;
  label: string;
  external?: boolean;
}

export type CaptureRainPieceRole = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';

export interface FallingCapturePiece {
  id: number;
  color: 'white' | 'black';
  role: CaptureRainPieceRole;
  style: CSSProperties & Record<`--${string}`, string>;
}

export interface AutoPlayAnimationPayload {
  autoPlayedMoves: string[];
  autoPlayStartFen: string | null;
  rewindFens: string[];
  nextState: SessionStatePayload;
}

export interface HistoryPreviewData {
  sessionId: string;
  fen: string;
  puzzleTitle: string;
  puzzlePublicId: string;
  createdAt: string;
  label: string;
}

export interface HistoryPreviewState extends HistoryPreviewData {
  tone: HistoryDotTone;
  x: number;
  y: number;
  loading: boolean;
}

export interface PrefetchedNextState {
  sourceSessionId: string;
  mode: StartSessionResponse['state']['variationMode'];
  autoNext: boolean;
  response: StartSessionResponse;
}

export interface TerminalEvalDisplay {
  cp: null;
  mate: number;
  text: string;
  sideText: string;
  depthText: string;
}

export type UiMessage =
  | { kind: 'literal'; value: string }
  | { kind: 'translated'; resolve: (i18n: FrontendI18n) => string };

export function withBasePath(relativePath: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${relativePath.replace(/^\/+/, '')}`;
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function maybeWait(ms: number, enabled: boolean): Promise<void> {
  if (ms <= 0 || !enabled) {
    return Promise.resolve();
  }
  return wait(ms);
}

export function getFeedbackDelay(ms: number, animationsEnabled: boolean): number {
  if (ms <= 0) {
    return 0;
  }

  return animationsEnabled ? ms : NO_ANIMATION_DELAY_MS;
}

export function applyUciMove(chess: Chess, uciMove: string): boolean {
  if (uciMove.length < 4) {
    return false;
  }

  const from = uciMove.slice(0, 2) as Square;
  const to = uciMove.slice(2, 4) as Square;
  const promotion = (uciMove[4] as PieceSymbol | undefined) ?? undefined;
  try {
    const result = chess.move({ from, to, promotion });
    return Boolean(result);
  } catch {
    return false;
  }
}

export function getMoveSoundDecision(fen: string, uciMove: string): MoveSoundDecision {
  if (uciMove.length < 4) {
    return { primary: null, isCheck: false };
  }

  const chess = new Chess(fen);
  const from = uciMove.slice(0, 2) as Square;
  const to = uciMove.slice(2, 4) as Square;
  const promotion = (uciMove[4] as PieceSymbol | undefined) ?? undefined;
  let move;

  try {
    move = chess.move({ from, to, promotion });
  } catch {
    return { primary: null, isCheck: false };
  }

  if (!move) {
    return { primary: null, isCheck: false };
  }

  const isCheck = chess.inCheck();

  if (move.isKingsideCastle() || move.isQueensideCastle()) {
    return { primary: 'castle', isCheck };
  }

  if (move.isCapture()) {
    return { primary: 'capture', isCheck };
  }

  return { primary: 'move', isCheck };
}

export function playMoveSoundDecision(decision: MoveSoundDecision, enabled: boolean): void {
  if (!enabled) {
    return;
  }
  if (decision.primary) {
    playMoveSound(decision.primary);
  }
  if (decision.isCheck) {
    if (CHECK_SOUND_DELAY_MS <= 0) {
      playMoveSound('check');
      return;
    }
    window.setTimeout(() => {
      playMoveSound('check');
    }, CHECK_SOUND_DELAY_MS);
  }
}

export function getFenAfterUciMove(fen: string, uciMove: string): string | null {
  const chess = new Chess(fen);
  const ok = applyUciMove(chess, uciMove);
  if (!ok) {
    return null;
  }
  return chess.fen();
}

export function getMoveSquares(uciMove: string): [Square, Square] | null {
  if (uciMove.length < 4) {
    return null;
  }

  return [uciMove.slice(0, 2) as Square, uciMove.slice(2, 4) as Square];
}

function getFenStateKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export function getMoveSquaresBetweenFens(beforeFen: string, afterFen: string): [Square, Square] | null {
  const chess = new Chess(beforeFen);
  const targetKey = getFenStateKey(afterFen);

  for (const move of chess.moves({ verbose: true })) {
    chess.move(move);
    const matches = getFenStateKey(chess.fen()) === targetKey;
    chess.undo();
    if (matches) {
      return [move.from as Square, move.to as Square];
    }
  }

  return null;
}

const CAPTURE_RAIN_ROLE_BY_SYMBOL: Record<PieceSymbol, CaptureRainPieceRole> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king'
};

export function getCapturedPieceSkin(
  fen: string,
  uciMove: string
): Pick<FallingCapturePiece, 'color' | 'role'> | null {
  if (uciMove.length < 4) {
    return null;
  }

  const chess = new Chess(fen);
  const from = uciMove.slice(0, 2) as Square;
  const to = uciMove.slice(2, 4) as Square;
  const promotion = (uciMove[4] as PieceSymbol | undefined) ?? undefined;
  let move;

  try {
    move = chess.move({ from, to, promotion });
  } catch {
    return null;
  }

  if (!move?.captured) {
    return null;
  }

  return {
    color: move.color === 'w' ? 'black' : 'white',
    role: CAPTURE_RAIN_ROLE_BY_SYMBOL[move.captured]
  };
}

export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function isPuzzleSolved(snapshot: SessionStatePayload): boolean {
  return snapshot.completedBranches >= snapshot.totalLines;
}

export function getTerminalEvalDisplay(fen: string | null, i18n: FrontendI18n): TerminalEvalDisplay | null {
  if (!fen) {
    return null;
  }

  const chess = new Chess(fen);

  if (chess.isCheckmate()) {
    const whiteWon = chess.turn() === 'b';
    return {
      cp: null,
      mate: whiteWon ? 1 : -1,
      text: i18n.checkmate,
      sideText: whiteWon ? i18n.whiteWinning : i18n.blackWinning,
      depthText: i18n.terminalDepth
    };
  }

  if (chess.isStalemate()) {
    return {
      cp: null,
      mate: 0,
      text: i18n.stalemate,
      sideText: i18n.drawn,
      depthText: i18n.terminalDepth
    };
  }

  if (chess.isDraw()) {
    return {
      cp: null,
      mate: 0,
      text: i18n.draw,
      sideText: i18n.drawn,
      depthText: i18n.terminalDepth
    };
  }

  return null;
}

export function formatEngineEval(
  cp: number | null,
  mate: number | null,
  error: string | null,
  i18n: FrontendI18n
): string {
  if (error) {
    return i18n.unavailable;
  }

  if (mate !== null) {
    return `M${mate}`;
  }

  if (cp === null) {
    return '--';
  }

  const pawns = cp / 100;
  const sign = pawns > 0 ? '+' : '';
  return `${sign}${pawns.toFixed(2)}`;
}

export function formatEngineSide(
  cp: number | null,
  mate: number | null,
  error: string | null,
  i18n: FrontendI18n
): string {
  if (error) {
    return i18n.engineUnavailable;
  }

  if (mate !== null) {
    if (mate === 0) {
      return i18n.drawn;
    }
    return mate > 0 ? i18n.whiteWinning : i18n.blackWinning;
  }

  if (cp === null) {
    return i18n.neutral;
  }

  if (Math.abs(cp) <= 25) {
    return i18n.neutral;
  }

  return cp > 0 ? i18n.whiteBetter : i18n.blackBetter;
}

export function appendSimilarVariationStatus(
  base: string,
  skippedSimilarVariations: number,
  i18n: FrontendI18n
): string {
  if (skippedSimilarVariations <= 0) {
    return base;
  }

  return `${base}. ${i18n.similarVariationsSkipped(skippedSimilarVariations)}`;
}

export function literalUiMessage(value: string): UiMessage {
  return { kind: 'literal', value };
}

export function translatedUiMessage(resolve: (i18n: FrontendI18n) => string): UiMessage {
  return { kind: 'translated', resolve };
}

export function resolveUiMessage(message: UiMessage | null, i18n: FrontendI18n): string | null {
  if (!message) {
    return null;
  }

  return message.kind === 'literal' ? message.value : message.resolve(i18n);
}
