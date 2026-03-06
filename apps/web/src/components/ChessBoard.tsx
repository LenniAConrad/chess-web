import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';

type PromotionPiece = 'q' | 'r' | 'b' | 'n';

interface ChessBoardProps {
  fen: string;
  orientation: 'white' | 'black';
  interactive: boolean;
  autoQueenPromotion: boolean;
  hintSquare: string | null;
  lastMove: [string, string] | null;
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

const PROMOTION_PIECES: PromotionPiece[] = ['q', 'n', 'r', 'b'];

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

function isPromotionMove(fen: string, from: string, to: string): boolean {
  const chess = new Chess(fen);
  const piece = chess.get(from as Square);
  if (piece?.type !== 'p' || (!to.endsWith('1') && !to.endsWith('8'))) {
    return false;
  }

  return chess
    .moves({ verbose: true })
    .some((move) => move.from === from && move.to === to && Boolean(move.promotion));
}

function toUci(fen: string, from: string, to: string, promotionPiece: PromotionPiece = 'q'): string {
  const chess = new Chess(fen);
  const piece = chess.get(from as Square);
  const isPromotion = piece?.type === 'p' && (to.endsWith('1') || to.endsWith('8'));
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

export function ChessBoard({
  fen,
  orientation,
  interactive,
  autoQueenPromotion,
  hintSquare,
  lastMove,
  onMove
}: ChessBoardProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);

  const destinations = useMemo(() => legalDestinations(fen), [fen]);
  const chessgroundLastMove = useMemo<Key[] | undefined>(
    () => (lastMove ? [lastMove[0] as Key, lastMove[1] as Key] : undefined),
    [lastMove]
  );
  const promotionLayout = useMemo(
    () => (pendingPromotion ? getPromotionLayout(pendingPromotion.to, orientation) : null),
    [orientation, pendingPromotion]
  );

  const handleBoardMove = useCallback(
    (from: string, to: string) => {
      if (!interactive) {
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
    [autoQueenPromotion, chessgroundLastMove, fen, interactive, onMove]
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
      orientation,
      coordinates: false,
      animation: {
        enabled: true,
        duration: 200
      },
      movable: {
        free: false,
        color: 'both',
        dests: destinations,
        events: {
          after: handleBoardMove
        }
      }
    });
  }, [chessgroundLastMove, destinations, fen, handleBoardMove, orientation]);

  useEffect(() => {
    apiRef.current?.set({
      fen,
      lastMove: chessgroundLastMove,
      orientation,
      coordinates: false,
      animation: {
        enabled: true,
        duration: 200
      },
      movable: {
        free: false,
        color: interactive ? 'both' : undefined,
        dests: interactive ? destinations : new Map(),
        events: {
          after: handleBoardMove
        }
      },
      drawable: {
        enabled: Boolean(hintSquare),
        visible: true,
        autoShapes: hintSquare
          ? [
              {
                orig: hintSquare as Key,
                dest: hintSquare as Key,
                brush: 'green'
              }
            ]
          : []
      }
    });
  }, [chessgroundLastMove, destinations, fen, handleBoardMove, hintSquare, interactive, orientation]);

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
