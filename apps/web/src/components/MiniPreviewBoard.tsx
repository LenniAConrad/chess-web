import { useEffect, useMemo, useRef, useState } from 'react';
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

function snapBoardPixels(size: number): number {
  if (!Number.isFinite(size) || size <= 0) {
    return 0;
  }

  return Math.floor(size / 8) * 8;
}

export function MiniPreviewBoard({ fen, orientation, glassEnabled }: MiniPreviewBoardProps) {
  const boardWrapRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const [boardSize, setBoardSize] = useState<number | null>(null);
  const turnColor = useMemo(() => turnColorFromFen(fen), [fen]);
  const checkColor = useMemo(() => checkColorFromFen(fen), [fen]);

  useEffect(() => {
    const boardWrap = boardWrapRef.current;
    const host = boardWrap?.parentElement;
    if (!boardWrap || !host || typeof ResizeObserver === 'undefined') {
      return;
    }

    let frameId = 0;

    const syncBoardSize = () => {
      frameId = 0;
      const nextSize = snapBoardPixels(host.getBoundingClientRect().width);
      setBoardSize((current) => (current === nextSize ? current : nextSize));
    };

    const queueSyncBoardSize = () => {
      if (frameId !== 0) {
        return;
      }
      frameId = window.requestAnimationFrame(syncBoardSize);
    };

    queueSyncBoardSize();

    const observer = new ResizeObserver(() => {
      queueSyncBoardSize();
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

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

  useEffect(() => {
    if (!apiRef.current || boardSize === null) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      apiRef.current?.redrawAll();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [boardSize]);

  const boardWrapStyle =
    boardSize === null
      ? undefined
      : {
          width: `${boardSize}px`,
          height: `${boardSize}px`
        };

  return (
    <div
      ref={boardWrapRef}
      className={`board-wrap mini-preview-board-wrap ${glassEnabled ? 'glass-enabled' : ''}`}
      style={boardWrapStyle}
    >
      <div ref={containerRef} className="board mini-preview-board" />
    </div>
  );
}
