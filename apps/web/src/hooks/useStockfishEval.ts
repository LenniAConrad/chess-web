import { useEffect, useRef, useState } from 'react';

interface EvalState {
  cp: number | null;
  mate: number | null;
  depth: number;
  ready: boolean;
  error: string | null;
}

type SideToMove = 'w' | 'b';

const INITIAL_STATE: EvalState = {
  cp: null,
  mate: null,
  depth: 0,
  ready: false,
  error: null
};

const MAX_SEARCH_DEPTH = 25;
const SEARCH_TIMEOUT_MS = 2500;

function parseInfoLine(line: string): { cp: number | null; mate: number | null; depth: number } | null {
  const match = /info depth (\d+).*score (cp|mate) (-?\d+)/.exec(line);
  if (!match) {
    return null;
  }

  const depthToken = match[1];
  const scoreType = match[2];
  const scoreToken = match[3];
  if (!depthToken || !scoreType || !scoreToken) {
    return null;
  }

  const depth = Number.parseInt(depthToken, 10);
  const score = Number.parseInt(scoreToken, 10);

  if (scoreType === 'cp') {
    return { cp: score, mate: null, depth };
  }

  return { cp: null, mate: score, depth };
}

function getSideToMoveFromFen(fen: string): SideToMove {
  const parts = fen.trim().split(/\s+/);
  return parts[1] === 'b' ? 'b' : 'w';
}

function toWhitePerspective(
  value: { cp: number | null; mate: number | null; depth: number },
  sideToMove: SideToMove
): { cp: number | null; mate: number | null; depth: number } {
  const multiplier = sideToMove === 'w' ? 1 : -1;
  return {
    cp: value.cp === null ? null : value.cp * multiplier,
    mate: value.mate === null ? null : value.mate * multiplier,
    depth: value.depth
  };
}

export function useStockfishEval(fen: string | null) {
  const workerRef = useRef<Worker | null>(null);
  const sideToMoveRef = useRef<SideToMove>('w');
  const activeSearchIdRef = useRef(0);
  const searchCounterRef = useRef(0);
  const pendingSearchRef = useRef<{ id: number; fen: string; sideToMove: SideToMove } | null>(null);
  const [evalState, setEvalState] = useState<EvalState>(INITIAL_STATE);

  useEffect(() => {
    let canceled = false;

    try {
      const worker = new Worker(new URL('stockfish/src/stockfish-nnue-16-single.js', import.meta.url), {
        type: 'classic'
      });

      workerRef.current = worker;
      worker.postMessage('uci');
      worker.postMessage('isready');

      worker.onmessage = (event: MessageEvent<string>) => {
        if (canceled) {
          return;
        }

        const line = String(event.data);
        if (line.includes('readyok')) {
          setEvalState((previous) => (previous.ready ? previous : { ...previous, ready: true }));

          const pendingSearch = pendingSearchRef.current;
          if (pendingSearch && workerRef.current) {
            activeSearchIdRef.current = pendingSearch.id;
            sideToMoveRef.current = pendingSearch.sideToMove;
            pendingSearchRef.current = null;
            workerRef.current.postMessage(`position fen ${pendingSearch.fen}`);
            workerRef.current.postMessage(`go depth ${MAX_SEARCH_DEPTH}`);
          }
          return;
        }

        const parsed = parseInfoLine(line);
        if (!parsed || activeSearchIdRef.current === 0) {
          return;
        }
        const whitePerspective = toWhitePerspective(parsed, sideToMoveRef.current);

        setEvalState((previous) => {
          if (whitePerspective.depth < previous.depth) {
            return previous;
          }

          return {
            cp: whitePerspective.cp,
            mate: whitePerspective.mate,
            depth: whitePerspective.depth,
            ready: previous.ready,
            error: null
          };
        });
      };

      worker.onerror = () => {
        setEvalState((previous) => ({
          ...previous,
          error: 'Stockfish failed to initialize'
        }));
      };
    } catch (error) {
      setEvalState((previous) => ({
        ...previous,
        error: error instanceof Error ? error.message : 'Stockfish worker failed'
      }));
    }

    return () => {
      canceled = true;
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!fen || !workerRef.current || !evalState.ready) {
      return;
    }

    setEvalState((previous) => ({
      ...previous,
      cp: null,
      mate: null,
      depth: 0
    }));
    const requestId = searchCounterRef.current + 1;
    searchCounterRef.current = requestId;
    pendingSearchRef.current = {
      id: requestId,
      fen,
      sideToMove: getSideToMoveFromFen(fen)
    };
    activeSearchIdRef.current = 0;
    workerRef.current.postMessage('stop');
    workerRef.current.postMessage('isready');

    const timeout = window.setTimeout(() => {
      if (pendingSearchRef.current?.id === requestId || activeSearchIdRef.current === requestId) {
        workerRef.current?.postMessage('stop');
        activeSearchIdRef.current = 0;
      }
    }, SEARCH_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeout);
      if (pendingSearchRef.current?.id === requestId) {
        pendingSearchRef.current = null;
      }
      if (activeSearchIdRef.current === requestId) {
        workerRef.current?.postMessage('stop');
        activeSearchIdRef.current = 0;
      }
    };
  }, [fen, evalState.ready]);

  return evalState;
}
