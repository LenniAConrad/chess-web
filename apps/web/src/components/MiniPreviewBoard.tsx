import { useEffect, useMemo, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';

interface MiniPreviewBoardProps {
  fen: string;
  orientation: 'white' | 'black';
  glassEnabled: boolean;
}

function turnColorFromFen(fen: string): 'white' | 'black' {
  return fen.trim().split(/\s+/)[1] === 'b' ? 'black' : 'white';
}

function checkColorFromFen(fen: string): 'white' | 'black' | false {
  const chess = new Chess(fen);
  if (!chess.inCheck()) {
    return false;
  }

  return chess.turn() === 'w' ? 'white' : 'black';
}

export function MiniPreviewBoard({ fen, orientation, glassEnabled }: MiniPreviewBoardProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const turnColor = useMemo(() => turnColorFromFen(fen), [fen]);
  const checkColor = useMemo(() => checkColorFromFen(fen), [fen]);

  useEffect(() => {
    if (!containerRef.current || apiRef.current) {
      return;
    }

    apiRef.current = Chessground(containerRef.current, {
      fen,
      check: checkColor,
      turnColor,
      orientation,
      coordinates: false,
      animation: {
        enabled: false,
        duration: 0
      },
      movable: {
        free: false,
        color: undefined
      }
    });

    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
    };
  }, [checkColor, fen, orientation, turnColor]);

  useEffect(() => {
    apiRef.current?.set({
      fen,
      check: checkColor,
      turnColor,
      orientation,
      coordinates: false,
      animation: {
        enabled: false,
        duration: 0
      },
      movable: {
        free: false,
        color: undefined
      }
    });
  }, [checkColor, fen, orientation, turnColor]);

  return (
    <div className={`board-wrap mini-preview-board-wrap ${glassEnabled ? 'glass-enabled' : ''}`}>
      <div ref={containerRef} className="board mini-preview-board" />
    </div>
  );
}
