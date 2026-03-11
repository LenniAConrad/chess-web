import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key, MoveMetadata } from 'chessground/types';
import { lichessStylePremoveDests } from '../lib/lichessPremove';

type PromotionPiece = 'q' | 'r' | 'b' | 'n';

interface ChessBoardProps {
  fen: string;
  orientation: 'white' | 'black';
  checkColor: 'white' | 'black' | false;
  interactive: boolean;
  canMoveExecution: boolean;
  animationsEnabled: boolean;
  premoveResetToken: string | null;
  autoQueenPromotion: boolean;
  hintSquare: string | null;
  hintArrow: [string, string] | null;
  lastMove: [string, string] | null;
  wrongMoveSquare: string | null;
  wrongMoveFlashToken: number;
  onMove: (uci: string) => void;
}

interface PendingPromotion {
  from: string;
  to: string;
  color: 'w' | 'b';
}

interface PromotionLayout {
  leftPct: number;
  topPct: number;
  fromTop: boolean;
}

interface SquareLayout {
  leftPct: number;
  topPct: number;
}

type CoordinateTone = 'on-light' | 'on-dark';

interface CoordinateLabel {
  key: string;
  text: string;
  leftPct: number;
  topPct: number;
  tone: CoordinateTone;
  variant: 'file' | 'rank';
}

const PROMOTION_PIECES: PromotionPiece[] = ['q', 'n', 'r', 'b'];
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS_ASC = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

const PIECE_LABELS: Record<PromotionPiece, string> = {
  q: 'queen',
  n: 'knight',
  r: 'rook',
  b: 'bishop'
};

const PIECE_FILE_SUFFIX: Record<PromotionPiece, 'Q' | 'N' | 'R' | 'B'> = {
  q: 'Q',
  n: 'N',
  r: 'R',
  b: 'B'
};

function withBasePath(relativePath: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${relativePath.replace(/^\/+/, '')}`;
}

function legalDestinations(fen: string): Map<Key, Key[]> {
  const chess = new Chess(fen);
  const map = new Map<Key, Key[]>();

  for (const move of chess.moves({ verbose: true })) {
    const from = move.from as Key;
    const to = move.to as Key;
    const existing = map.get(from) ?? [];
    existing.push(to);
    map.set(from, existing);
  }

  return map;
}

function turnColorFromFen(fen: string): 'white' | 'black' {
  const parts = fen.trim().split(/\s+/);
  return parts[1] === 'b' ? 'black' : 'white';
}

function isPromotionMove(fen: string, from: string, to: string): boolean {
  const chess = new Chess(fen);
  const piece = chess.get(from as Square);
  if (piece?.type !== 'p' || to.length !== 2) {
    return false;
  }

  const toRank = Number(to[1]);
  const fromRank = Number(from[1]);
  if (Number.isNaN(toRank) || Number.isNaN(fromRank)) {
    return false;
  }

  const rankDelta = toRank - fromRank;
  const expectedRankDelta = piece.color === 'w' ? 1 : -1;
  if (rankDelta !== expectedRankDelta) {
    return false;
  }

  const fileDelta = Math.abs(to.charCodeAt(0) - from.charCodeAt(0));
  if (fileDelta > 1) {
    return false;
  }

  return toRank === 1 || toRank === 8;
}

function toUci(fen: string, from: string, to: string, promotionPiece: PromotionPiece = 'q'): string {
  const isPromotion = isPromotionMove(fen, from, to);
  return isPromotion ? `${from}${to}${promotionPiece}` : `${from}${to}`;
}

function getPieceColorAtSquare(fen: string, square: string): 'w' | 'b' | null {
  const chess = new Chess(fen);
  const piece = chess.get(square as Square);
  return piece?.color ?? null;
}

function promotionImageSrc(piece: PromotionPiece, color: 'w' | 'b'): string {
  const side = color === 'w' ? 'w' : 'b';
  const suffix = PIECE_FILE_SUFFIX[piece];
  return withBasePath(`pieces/cburnett/${side}${suffix}.svg`);
}

function getPromotionLayout(square: string, orientation: 'white' | 'black'): PromotionLayout | null {
  if (square.length !== 2) {
    return null;
  }

  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  if (Number.isNaN(rank) || file < 0 || file > 7 || rank < 1 || rank > 8) {
    return null;
  }

  const displayFile = orientation === 'white' ? file : 7 - file;
  const displayRank = orientation === 'white' ? 8 - rank : rank - 1;
  const fromTop = displayRank === 0;
  const top = fromTop ? displayRank * 12.5 : (displayRank - 3) * 12.5;

  return {
    leftPct: displayFile * 12.5,
    topPct: Math.max(0, Math.min(50, top)),
    fromTop
  };
}

function getSquareLayout(square: string, orientation: 'white' | 'black'): SquareLayout | null {
  if (square.length !== 2) {
    return null;
  }

  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  if (Number.isNaN(rank) || file < 0 || file > 7 || rank < 1 || rank > 8) {
    return null;
  }

  const displayFile = orientation === 'white' ? file : 7 - file;
  const displayRank = orientation === 'white' ? 8 - rank : rank - 1;

  return {
    leftPct: displayFile * 12.5,
    topPct: displayRank * 12.5
  };
}

function isLightSquare(file: string, rank: string): boolean {
  const fileIndex = file.charCodeAt(0) - 97;
  const rankNumber = Number(rank);
  if (Number.isNaN(rankNumber) || fileIndex < 0 || fileIndex > 7 || rankNumber < 1 || rankNumber > 8) {
    return false;
  }
  return (fileIndex + rankNumber) % 2 === 0;
}

function getCoordinateTone(file: string, rank: string): CoordinateTone {
  return isLightSquare(file, rank) ? 'on-light' : 'on-dark';
}

export function ChessBoard({
  fen,
  orientation,
  checkColor,
  interactive,
  canMoveExecution,
  animationsEnabled,
  premoveResetToken,
  autoQueenPromotion,
  hintSquare,
  hintArrow,
  lastMove,
  wrongMoveSquare,
  wrongMoveFlashToken,
  onMove
}: ChessBoardProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);

  const turnColor = useMemo(() => turnColorFromFen(fen), [fen]);
  const destinations = useMemo(() => legalDestinations(fen), [fen]);
  const isPlayersTurn = turnColor === orientation;
  const chessgroundLastMove = useMemo<[Key, Key] | undefined>(
    () => (lastMove ? [lastMove[0] as Key, lastMove[1] as Key] : undefined),
    [lastMove]
  );
  const premoveDests = useMemo(
    () => (isPlayersTurn ? undefined : lichessStylePremoveDests(fen, orientation, chessgroundLastMove ?? null)),
    [chessgroundLastMove, fen, isPlayersTurn, orientation]
  );
  const promotionLayout = useMemo(
    () => (pendingPromotion ? getPromotionLayout(pendingPromotion.to, orientation) : null),
    [orientation, pendingPromotion]
  );
  const wrongMoveLayout = useMemo(
    () => (wrongMoveSquare ? getSquareLayout(wrongMoveSquare, orientation) : null),
    [orientation, wrongMoveSquare]
  );
  const coordinateLabels = useMemo<CoordinateLabel[]>(() => {
    const displayFiles = orientation === 'white' ? [...FILES] : [...FILES].reverse();
    const displayRanks = orientation === 'white' ? [...RANKS_ASC].reverse() : [...RANKS_ASC];
    const labels: CoordinateLabel[] = [];
    const bottomRank = displayRanks[7] ?? '1';
    const leftFile = displayFiles[0] ?? 'a';

    for (let index = 0; index < displayFiles.length; index += 1) {
      const file = displayFiles[index];
      if (!file) {
        continue;
      }
      labels.push({
        key: `file-${file}`,
        text: file,
        leftPct: index * 12.5,
        topPct: 87.5,
        tone: getCoordinateTone(file, bottomRank),
        variant: 'file'
      });
    }

    for (let index = 0; index < displayRanks.length; index += 1) {
      const rank = displayRanks[index];
      if (!rank) {
        continue;
      }
      labels.push({
        key: `rank-${rank}`,
        text: rank,
        leftPct: 0,
        topPct: index * 12.5,
        tone: getCoordinateTone(leftFile, rank),
        variant: 'rank'
      });
    }

    return labels;
  }, [orientation]);

  const handleBoardMove = useCallback(
    (from: string, to: string, metadata: MoveMetadata) => {
      if (!interactive) {
        return;
      }
      if (!canMoveExecution && !metadata.premove) {
        return;
      }

      if (!autoQueenPromotion && isPromotionMove(fen, from, to)) {
        const color = getPieceColorAtSquare(fen, from);
        if (color) {
          setPendingPromotion({ from, to, color });
          apiRef.current?.set({
            fen,
            lastMove: chessgroundLastMove
          });
          return;
        }
      }

      onMove(toUci(fen, from, to));
    },
    [autoQueenPromotion, canMoveExecution, chessgroundLastMove, fen, interactive, onMove]
  );

  useEffect(() => {
    if (!interactive || autoQueenPromotion) {
      setPendingPromotion(null);
    }
  }, [autoQueenPromotion, interactive, fen]);

  useEffect(() => {
    if (!containerRef.current || apiRef.current) {
      return;
    }

    apiRef.current = Chessground(containerRef.current, {
      fen,
      lastMove: chessgroundLastMove,
      check: checkColor,
      turnColor,
      orientation,
      coordinates: false,
      animation: {
        enabled: animationsEnabled,
        duration: animationsEnabled ? 200 : 0
      },
      movable: {
        free: false,
        color: interactive ? orientation : undefined,
        dests: destinations,
        events: {
          after: handleBoardMove
        }
      },
      premovable: {
        enabled: interactive,
        customDests: premoveDests,
        showDests: !isPlayersTurn
      }
    });
  }, [
    animationsEnabled,
    checkColor,
    chessgroundLastMove,
    destinations,
    fen,
    handleBoardMove,
    interactive,
    isPlayersTurn,
    orientation,
    premoveDests,
    turnColor
  ]);

  useEffect(() => {
    apiRef.current?.set({
      fen,
      lastMove: chessgroundLastMove,
      check: checkColor,
      turnColor,
      orientation,
      coordinates: false,
      animation: {
        enabled: animationsEnabled,
        duration: animationsEnabled ? 200 : 0
      },
      movable: {
        free: false,
        color: interactive ? orientation : undefined,
        dests: interactive ? destinations : new Map(),
        events: {
          after: handleBoardMove
        }
      },
      premovable: {
        enabled: interactive,
        customDests: premoveDests,
        showDests: !isPlayersTurn
      },
      drawable: {
        enabled: Boolean(hintSquare || hintArrow),
        visible: true,
        autoShapes: [
          ...(hintSquare
            ? [
                {
                  orig: hintSquare as Key,
                  dest: hintSquare as Key,
                  brush: 'green' as const
                }
              ]
            : []),
          ...(hintArrow
            ? [
                {
                  orig: hintArrow[0] as Key,
                  dest: hintArrow[1] as Key,
                  brush: 'green' as const
                }
              ]
            : [])
        ]
      }
    });
  }, [
    animationsEnabled,
    checkColor,
    chessgroundLastMove,
    destinations,
    fen,
    handleBoardMove,
    hintArrow,
    hintSquare,
    interactive,
    isPlayersTurn,
    orientation,
    premoveDests,
    turnColor
  ]);

  useEffect(() => {
    if (!interactive || !canMoveExecution) {
      return;
    }

    apiRef.current?.playPremove();
  }, [canMoveExecution, fen, interactive, turnColor]);

  useEffect(() => {
    apiRef.current?.cancelPremove();
    setPendingPromotion(null);
  }, [premoveResetToken]);

  const applyPromotion = useCallback(
    (piece: PromotionPiece) => {
      if (!pendingPromotion) {
        return;
      }
      onMove(toUci(fen, pendingPromotion.from, pendingPromotion.to, piece));
      setPendingPromotion(null);
    },
    [fen, onMove, pendingPromotion]
  );

  const cancelPromotion = useCallback(() => {
    setPendingPromotion(null);
    apiRef.current?.set({
      fen,
      lastMove: chessgroundLastMove
    });
  }, [chessgroundLastMove, fen]);

  return (
    <div className="board-wrap">
      <div ref={containerRef} className="board" />
      <div className="board-coordinates" aria-hidden="true">
        {coordinateLabels.map((label) => (
          <span
            key={label.key}
            className={`board-coordinate board-coordinate-${label.variant} ${label.tone}`}
            style={{
              left: `${label.leftPct}%`,
              top: `${label.topPct}%`
            }}
          >
            {label.text}
          </span>
        ))}
      </div>
      {wrongMoveLayout ? (
        <div
          key={wrongMoveFlashToken}
          className="wrong-move-marker-anchor"
          style={{
            left: `${wrongMoveLayout.leftPct}%`,
            top: `${wrongMoveLayout.topPct}%`
          }}
          aria-hidden="true"
        >
          <span className="wrong-move-marker" />
        </div>
      ) : null}
      {pendingPromotion && promotionLayout ? (
        <div role="dialog" aria-label="Choose promotion piece">
          <button type="button" className="promotion-backdrop" aria-label="Cancel promotion" onClick={cancelPromotion} />
          <div
            className={`promotion-menu ${promotionLayout.fromTop ? 'from-top' : 'from-bottom'}`}
            style={{
              left: `${promotionLayout.leftPct}%`,
              top: `${promotionLayout.topPct}%`
            }}
          >
            {PROMOTION_PIECES.map((piece) => (
              <button
                key={piece}
                type="button"
                className="promotion-option"
                onClick={() => applyPromotion(piece)}
                aria-label={`Promote to ${PIECE_LABELS[piece]}`}
              >
                <img src={promotionImageSrc(piece, pendingPromotion.color)} alt="" className="promotion-piece-img" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
