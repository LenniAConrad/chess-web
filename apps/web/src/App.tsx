import {
  type AnimationEvent as ReactAnimationEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';
import { Chess, type PieceSymbol, type Square } from 'chess.js';
import { ChessBoard } from './components/ChessBoard.js';
import { EvalBar } from './components/EvalBar.js';
import { MiniPreviewBoard } from './components/MiniPreviewBoard.js';
import { useLocalPrefs } from './hooks/useLocalPrefs.js';
import { useStockfishEval } from './hooks/useStockfishEval.js';
import { getHistoryDotLabel, getHistoryDotSymbol, getHistoryDotTone } from './lib/historyDots.js';
import {
  cacheLoadedSession,
  getPuzzleCount,
  getHint,
  loadSession,
  refreshSession,
  getSessionHistory,
  getSessionTree,
  nextPuzzle,
  prefetchNextPuzzle,
  playMove,
  retainLoadedSessions,
  revealSolution,
  skipVariation,
  startSession
} from './lib/api.js';
import { playMoveSound, primeMoveSounds, type MoveSoundType } from './lib/moveSounds.js';
import type {
  SessionHistoryItem,
  SessionStatePayload,
  SessionTreeNode,
  SessionTreeResponse,
  StartSessionResponse
} from './types/api.js';

interface PuzzleHeader {
  publicId: string;
  startFen: string;
  title: string;
}

const AUTO_PLAY_DELAY_MS = 900;
const CORRECT_BREAK_MS = 750;
const REWIND_STEP_DELAY_MS = 260;
const REWIND_BREAK_MS = 700;
const SHORT_STATUS_DELAY_MS = 700;
const CHECK_SOUND_DELAY_MS = 0;
const WRONG_MOVE_FEEDBACK_MS = 520;
const SESSION_HISTORY_FETCH_LIMIT = 100;
const NO_ANIMATION_DELAY_MS = 180;
const MOBILE_HISTORY_PREVIEW_HOLD_MS = 260;
const REPO_URL = 'https://github.com/LenniAConrad/chess-web';
const COUNT_FORMATTER = new Intl.NumberFormat('en-US');

type PrimaryMoveSoundType = Exclude<MoveSoundType, 'check'>;

interface MoveSoundDecision {
  primary: PrimaryMoveSoundType | null;
  isCheck: boolean;
}

interface AppChromeLink {
  href: string;
  label: string;
  external?: boolean;
}

interface FallingCapturePiece {
  id: number;
  src: string;
  style: CSSProperties & Record<`--${string}`, string>;
}

interface AutoPlayAnimationPayload {
  autoPlayedMoves: string[];
  autoPlayStartFen: string | null;
  rewindFens: string[];
  nextState: SessionStatePayload;
}

interface HistoryPreviewData {
  sessionId: string;
  fen: string;
  puzzleTitle: string;
  puzzlePublicId: string;
  createdAt: string;
  label: string;
}

interface HistoryPreviewState extends HistoryPreviewData {
  tone: ReturnType<typeof getHistoryDotTone>;
  x: number;
  y: number;
  loading: boolean;
}

interface PrefetchedNextState {
  sourceSessionId: string;
  mode: StartSessionResponse['state']['variationMode'];
  autoNext: boolean;
  response: StartSessionResponse;
}

const HISTORY_PREVIEW_DELAY_MS = 110;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function maybeWait(ms: number, enabled: boolean): Promise<void> {
  if (ms <= 0 || !enabled) {
    return Promise.resolve();
  }
  return wait(ms);
}

function applyUciMove(chess: Chess, uciMove: string): boolean {
  if (uciMove.length < 4) {
    return false;
  }

  const from = uciMove.slice(0, 2) as Square;
  const to = uciMove.slice(2, 4) as Square;
  const promotion = (uciMove[4] as PieceSymbol | undefined) ?? undefined;
  const result = chess.move({ from, to, promotion });
  return Boolean(result);
}

function getMoveSoundDecision(fen: string, uciMove: string): MoveSoundDecision {
  if (uciMove.length < 4) {
    return { primary: null, isCheck: false };
  }

  const chess = new Chess(fen);
  const from = uciMove.slice(0, 2) as Square;
  const to = uciMove.slice(2, 4) as Square;
  const promotion = (uciMove[4] as PieceSymbol | undefined) ?? undefined;
  const move = chess.move({ from, to, promotion });

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

function playMoveSoundDecision(decision: MoveSoundDecision, enabled: boolean): void {
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

function getFenAfterUciMove(fen: string, uciMove: string): string | null {
  const chess = new Chess(fen);
  const ok = applyUciMove(chess, uciMove);
  if (!ok) {
    return null;
  }
  return chess.fen();
}

function getMoveSquares(uciMove: string): [Square, Square] | null {
  if (uciMove.length < 4) {
    return null;
  }

  return [uciMove.slice(0, 2) as Square, uciMove.slice(2, 4) as Square];
}

function getFenStateKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

function getMoveSquaresBetweenFens(beforeFen: string, afterFen: string): [Square, Square] | null {
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

function getCapturedPieceAsset(fen: string, uciMove: string): string | null {
  if (uciMove.length < 4) {
    return null;
  }

  const chess = new Chess(fen);
  const from = uciMove.slice(0, 2) as Square;
  const to = uciMove.slice(2, 4) as Square;
  const promotion = (uciMove[4] as PieceSymbol | undefined) ?? undefined;
  const move = chess.move({ from, to, promotion });

  if (!move?.captured) {
    return null;
  }

  const capturedColor = move.color === 'w' ? 'b' : 'w';
  return `/pieces/cburnett/${capturedColor}${move.captured.toUpperCase()}.svg`;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function isPuzzleSolved(snapshot: SessionStatePayload): boolean {
  return snapshot.completedBranches >= snapshot.totalLines;
}

function formatEngineEval(cp: number | null, mate: number | null, error: string | null): string {
  if (error) {
    return 'unavailable';
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

function formatEngineSide(cp: number | null, mate: number | null, error: string | null): string {
  if (error) {
    return 'Engine unavailable';
  }

  if (mate !== null) {
    if (mate === 0) {
      return 'Drawn';
    }
    return mate > 0 ? 'White winning' : 'Black winning';
  }

  if (cp === null) {
    return 'Neutral';
  }

  if (Math.abs(cp) <= 25) {
    return 'Neutral';
  }

  return cp > 0 ? 'White better' : 'Black better';
}

export function App() {
  /**
   * `App` is the session orchestrator for the full UI:
   * - manages API-driven puzzle/session state
   * - drives board/status animations and sound decisions
   * - coordinates history + PGN explorer + settings persistence
   */
  const { prefs, setPrefs } = useLocalPrefs();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [puzzle, setPuzzle] = useState<PuzzleHeader | null>(null);
  const [state, setState] = useState<SessionStatePayload | null>(null);
  const [displayFen, setDisplayFen] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('Loading puzzle...');
  const [correctText, setCorrectText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [puzzleCount, setPuzzleCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hintSquare, setHintSquare] = useState<string | null>(null);
  const [hintArrow, setHintArrow] = useState<[Square, Square] | null>(null);
  const [hintLevel, setHintLevel] = useState(0);
  const [lastBestMove, setLastBestMove] = useState<string | null>(null);
  const [playerOrientation, setPlayerOrientation] = useState<'white' | 'black'>('white');
  const [lastMoveSquares, setLastMoveSquares] = useState<[Square, Square] | null>(null);
  const [puzzleIdInput, setPuzzleIdInput] = useState('');
  const [historyItems, setHistoryItems] = useState<SessionHistoryItem[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [sessionTree, setSessionTree] = useState<SessionTreeResponse | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [reviewPath, setReviewPath] = useState<number[] | null>(null);
  const [wrongMoveSquare, setWrongMoveSquare] = useState<Square | null>(null);
  const [wrongMoveFlashToken, setWrongMoveFlashToken] = useState(0);
  const [lineCompleteSquare, setLineCompleteSquare] = useState<Square | null>(null);
  const [lineCompleteFlashToken, setLineCompleteFlashToken] = useState(0);
  const [fallingCapturePieces, setFallingCapturePieces] = useState<FallingCapturePiece[]>([]);
  const [oneTryFailed, setOneTryFailed] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<HistoryPreviewState | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const headerSettingsRef = useRef<HTMLDetailsElement | null>(null);
  const capturePieceIdRef = useRef(0);
  const historyPreviewCacheRef = useRef(new Map<string, HistoryPreviewData>());
  const historyPreviewDelayRef = useRef<number | null>(null);
  const historyPreviewRequestRef = useRef(0);
  const mobileHistoryHoldRef = useRef<number | null>(null);
  const mobileHistoryPreviewSessionRef = useRef<string | null>(null);
  const suppressHistoryDotClickRef = useRef<string | null>(null);
  const prefetchedNextRef = useRef<PrefetchedNextState | null>(null);
  const prefetchedNextRequestRef = useRef(0);
  const recentHistoryItems = historyItems;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const media = window.matchMedia('(max-width: 900px)');
    const syncViewport = () => {
      setIsMobileViewport(media.matches);
    };

    syncViewport();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', syncViewport);
      return () => media.removeEventListener('change', syncViewport);
    }

    media.addListener(syncViewport);
    return () => media.removeListener(syncViewport);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void getPuzzleCount()
      .then((response) => {
        if (!cancelled) {
          setPuzzleCount(response.count);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPuzzleCount(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!prefs.soundEnabled) {
      return;
    }

    primeMoveSounds();
  }, [prefs.soundEnabled]);

  const reviewNodeId = reviewPath?.at(-1) ?? null;
  const treeNodeMap = useMemo(() => {
    const map = new Map<number, SessionTreeNode>();
    if (!sessionTree) {
      return map;
    }

    for (const node of sessionTree.nodes) {
      map.set(node.id, node);
    }

    return map;
  }, [sessionTree]);

  const treeChildrenMap = useMemo(() => {
    const map = new Map<number, SessionTreeNode[]>();
    if (!sessionTree) {
      return map;
    }

    for (const node of sessionTree.nodes) {
      if (node.parent_id === null) {
        continue;
      }

      const siblings = map.get(node.parent_id) ?? [];
      siblings.push(node);
      map.set(node.parent_id, siblings);
    }

    for (const siblings of map.values()) {
      siblings.sort((a, b) => a.sibling_order - b.sibling_order || a.id - b.id);
    }

    return map;
  }, [sessionTree]);

  const isReviewMode = Boolean(reviewPath && reviewPath.length > 1);
  const reviewNode = reviewNodeId ? (treeNodeMap.get(reviewNodeId) ?? null) : null;
  const reviewFen = reviewNode?.fen_after ?? null;
  const liveFen = displayFen ?? state?.fen ?? null;
  const boardFen = reviewFen ?? liveFen;
  const reviewLastMoveSquares = useMemo(() => {
    if (!isReviewMode || !reviewPath || reviewPath.length < 2) {
      return null;
    }

    const nodeId = reviewPath[reviewPath.length - 1];
    if (!nodeId) {
      return null;
    }

    const node = treeNodeMap.get(nodeId);
    if (!node?.uci) {
      return null;
    }

    return getMoveSquares(node.uci);
  }, [isReviewMode, reviewPath, treeNodeMap]);

  const pgnCurrentNodeId = reviewNodeId ?? state?.nodeId ?? null;
  const pgnNextMoves = pgnCurrentNodeId ? (treeChildrenMap.get(pgnCurrentNodeId) ?? []) : [];
  const reviewMoves = useMemo(() => {
    if (!reviewPath || reviewPath.length < 2) {
      return [];
    }

    return reviewPath
      .slice(1)
      .map((nodeId) => treeNodeMap.get(nodeId)?.san ?? null)
      .filter((san): san is string => Boolean(san));
  }, [reviewPath, treeNodeMap]);

  const engineEval = useStockfishEval(boardFen, prefs.showEngineEval);
  const checkColor = (() => {
    if (!boardFen) {
      return false;
    }

    const chess = new Chess(boardFen);
    if (!chess.inCheck()) {
      return false;
    }

    return chess.turn() === 'w' ? 'white' : 'black';
  })();
  const turnLabel = (() => {
    if (!boardFen) {
      return '\u00A0';
    }
    const turn = new Chess(boardFen).turn();
    return turn === 'w' ? 'White to move' : 'Black to move';
  })();

  const engineEvalText = formatEngineEval(engineEval.cp, engineEval.mate, engineEval.error);
  const engineEvalSideText = formatEngineSide(engineEval.cp, engineEval.mate, engineEval.error);

  const resetHints = useCallback(() => {
    setHintSquare(null);
    setHintArrow(null);
    setHintLevel(0);
  }, []);

  const loadSessionArtifacts = useCallback(async (activeSessionId: string) => {
    try {
      const [history, tree] = await Promise.all([
        getSessionHistory(activeSessionId, SESSION_HISTORY_FETCH_LIMIT, true),
        getSessionTree(activeSessionId)
      ]);
      setHistoryItems(history.items);
      setHistoryError(null);
      setSessionTree(tree);
      setTreeError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load puzzle metadata';
      setTreeError(message);
      setHistoryError(message);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.darkMode ? 'dark' : 'light';
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [prefs.darkMode]);

  useEffect(() => {
    if (!sessionId || !puzzle || !state) {
      return;
    }

    cacheLoadedSession({
      sessionId,
      puzzle,
      state,
      ui: {
        autoNextDefault: prefs.autoNext
      }
    });
  }, [prefs.autoNext, puzzle, sessionId, state]);

  const takePrefetchedNextSession = useCallback(
    (sourceSessionId: string, mode: StartSessionResponse['state']['variationMode'], autoNext: boolean) => {
      const prefetched = prefetchedNextRef.current;
      if (
        !prefetched ||
        prefetched.sourceSessionId !== sourceSessionId ||
        prefetched.mode !== mode ||
        prefetched.autoNext !== autoNext
      ) {
        return null;
      }

      prefetchedNextRef.current = null;
      return prefetched.response;
    },
    []
  );

  const activatePrefetchedSession = useCallback((nextSessionId: string) => {
    void refreshSession(nextSessionId).catch(() => {
      // Prefetched activation is best-effort; normal interaction routes still recover by activating on demand.
    });
  }, []);

  useEffect(() => {
    return () => {
      if (historyPreviewDelayRef.current !== null) {
        window.clearTimeout(historyPreviewDelayRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const keepSessionIds = new Set(recentHistoryItems.map((item) => item.sessionId));
    if (sessionId) {
      keepSessionIds.add(sessionId);
    }

    retainLoadedSessions(keepSessionIds);

    for (const cachedSessionId of historyPreviewCacheRef.current.keys()) {
      if (!keepSessionIds.has(cachedSessionId)) {
        historyPreviewCacheRef.current.delete(cachedSessionId);
      }
    }
  }, [recentHistoryItems, sessionId]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const settingsEl = headerSettingsRef.current;
      const target = event.target;
      if (!settingsEl?.open || !(target instanceof Node)) {
        return;
      }

      if (!settingsEl.contains(target)) {
        settingsEl.open = false;
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !prefs.zenMode) {
        return;
      }

      setPrefs((previous) => ({
        ...previous,
        zenMode: false
      }));
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [prefs.zenMode, setPrefs]);

  useEffect(() => {
    if (!prefs.captureRain) {
      setFallingCapturePieces([]);
    }
  }, [prefs.captureRain]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    void loadSessionArtifacts(sessionId);
  }, [loadSessionArtifacts, sessionId]);

  useEffect(() => {
    if (!sessionId || !state || loading || historyLoading) {
      return;
    }

    const prefetched = prefetchedNextRef.current;
    if (
      prefetched &&
      prefetched.sourceSessionId === sessionId &&
      prefetched.mode === prefs.variationMode &&
      prefetched.autoNext === prefs.autoNext
    ) {
      return;
    }

    const requestId = ++prefetchedNextRequestRef.current;
    void prefetchNextPuzzle(sessionId, prefs.variationMode, prefs.autoNext)
      .then((response) => {
        if (prefetchedNextRequestRef.current !== requestId) {
          return;
        }

        prefetchedNextRef.current = {
          sourceSessionId: sessionId,
          mode: prefs.variationMode,
          autoNext: prefs.autoNext,
          response
        };
      })
      .catch(() => {
        if (prefetchedNextRequestRef.current === requestId) {
          prefetchedNextRef.current = null;
        }
      });
  }, [historyLoading, loading, prefs.autoNext, prefs.variationMode, sessionId, state]);

  const applyStartedSession = useCallback(
    (response: StartSessionResponse, status: string) => {
      cacheLoadedSession(response);
      prefetchedNextRequestRef.current += 1;
      prefetchedNextRef.current = null;
      setSessionId(response.sessionId);
      setPuzzle(response.puzzle);
      setPuzzleIdInput(response.puzzle.publicId);
      setState(response.state);
      setDisplayFen(response.state.fen);
      setPlayerOrientation(response.state.toMove === 'w' ? 'white' : 'black');
      setLastMoveSquares(null);
      resetHints();
      setLastBestMove(null);
      setCorrectText(null);
      setReviewPath(null);
      setSessionTree(null);
      setWrongMoveSquare(null);
      setLineCompleteSquare(null);
      setOneTryFailed(false);
      setStatusText(status);
    },
    [resetHints]
  );

  const removeCaptureRainPiece = useCallback((id: number) => {
    setFallingCapturePieces((previous) => previous.filter((entry) => entry.id !== id));
  }, []);

  const spawnCaptureRainPiece = useCallback(
    (fen: string, uciMove: string) => {
      if (!prefs.captureRain) {
        return;
      }

      const src = getCapturedPieceAsset(fen, uciMove);
      if (!src) {
        return;
      }

      const id = capturePieceIdRef.current++;
      const fallDurationMs = Math.round(randomBetween(6500, 12000));
      const piece = {
        id,
        src,
        style: {
          '--capture-x': `${randomBetween(4, 96).toFixed(2)}%`,
          '--capture-size': `${Math.round(randomBetween(44, 118))}px`,
          '--capture-drift-x': `${Math.round(randomBetween(-180, 180))}px`,
          '--capture-fall-duration': `${fallDurationMs}ms`,
          '--capture-spin-from': `${Math.round(randomBetween(-80, 80))}deg`,
          '--capture-spin-to': `${Math.round(randomBetween(-1440, 1440))}deg`,
          '--capture-opacity': randomBetween(0.45, 0.9).toFixed(2)
        }
      } satisfies FallingCapturePiece;

      setFallingCapturePieces((previous) => [...previous.slice(-11), piece]);
    },
    [prefs.captureRain]
  );

  const handleCaptureRainPieceAnimationEnd = useCallback(
    (event: ReactAnimationEvent<HTMLDivElement>, id: number) => {
      if (event.target !== event.currentTarget || event.animationName !== 'capture-piece-fall') {
        return;
      }

      removeCaptureRainPiece(id);
    },
    [removeCaptureRainPiece]
  );

  const animateAutoPlay = useCallback(
    async (
      response: AutoPlayAnimationPayload,
      currentFen: string,
      animationsEnabled: boolean,
      soundEnabled: boolean
    ): Promise<[Square, Square] | null> => {
      const rewindFens = response.rewindFens ?? [];
      let rewindSourceFen = currentFen;
      if (rewindFens.length > 0) {
        setStatusText('Correct. Rewinding for next variation...');
        await maybeWait(CORRECT_BREAK_MS, animationsEnabled);
        for (const fen of rewindFens) {
          setLastMoveSquares(getMoveSquaresBetweenFens(fen, rewindSourceFen));
          setDisplayFen(fen);
          rewindSourceFen = fen;
          await maybeWait(REWIND_STEP_DELAY_MS, animationsEnabled);
        }
        await maybeWait(REWIND_BREAK_MS, animationsEnabled);
      }

      if (!response.autoPlayStartFen || response.autoPlayedMoves.length === 0) {
        setDisplayFen(response.nextState.fen);
        return null;
      }

      const currentOrRewoundFen = rewindSourceFen;
      if (currentOrRewoundFen !== response.autoPlayStartFen) {
        setDisplayFen(response.autoPlayStartFen);
        await maybeWait(REWIND_STEP_DELAY_MS, animationsEnabled);
      }

      setStatusText('Correct. Opponent response...');
      const chess = new Chess(response.autoPlayStartFen);
      let finalMoveSquares: [Square, Square] | null = null;
      await maybeWait(AUTO_PLAY_DELAY_MS, animationsEnabled);

      for (const [index, move] of response.autoPlayedMoves.entries()) {
        const sourceFen = chess.fen();
        const soundDecision = getMoveSoundDecision(sourceFen, move);
        const ok = applyUciMove(chess, move);
        if (!ok) {
          break;
        }
        const moveSquares = getMoveSquares(move);
        if (moveSquares) {
          setLastMoveSquares(moveSquares);
          finalMoveSquares = moveSquares;
        }
        spawnCaptureRainPiece(sourceFen, move);
        playMoveSoundDecision(soundDecision, soundEnabled);
        setDisplayFen(chess.fen());
        if (index < response.autoPlayedMoves.length - 1) {
          await maybeWait(AUTO_PLAY_DELAY_MS, animationsEnabled);
        }
      }

      setDisplayFen(response.nextState.fen);
      return finalMoveSquares;
    },
    [spawnCaptureRainPiece]
  );

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setErrorText(null);
    setHistoryError(null);
    setTreeError(null);
    resetHints();
    setLastBestMove(null);
    setLastMoveSquares(null);
    setReviewPath(null);

    try {
      const response = await startSession(prefs.variationMode, prefs.autoNext);
      applyStartedSession(
        response,
        response.state.toMove === 'w' ? 'White to move' : 'Black to move'
      );
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to load puzzle');
      setStatusText('Failed to load puzzle');
    } finally {
      setLoading(false);
    }
  }, [applyStartedSession, prefs.autoNext, prefs.variationMode, resetHints]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const puzzleIsComplete = state ? isPuzzleSolved(state) : false;
  const oneTryLocked = prefs.oneTryMode && oneTryFailed;
  const panelControlsDisabled = loading || historyLoading || prefs.autoPlay;
  const boardCanInteract = !prefs.autoPlay && !historyLoading && !isReviewMode && !puzzleIsComplete && !oneTryLocked;

  const handleMove = useCallback(
    async (uciMove: string) => {
      if (
        !sessionId ||
        loading ||
        historyLoading ||
        !state ||
        isReviewMode ||
        isPuzzleSolved(state) ||
        oneTryLocked
      ) {
        return;
      }

      setWrongMoveSquare(null);
      setLineCompleteSquare(null);
      const baseFen = displayFen ?? state.fen;
      const moveSoundDecision = getMoveSoundDecision(baseFen, uciMove);
      const optimisticFen = getFenAfterUciMove(baseFen, uciMove);
      const optimisticLastMove = getMoveSquares(uciMove);
      if (optimisticFen) {
        setDisplayFen(optimisticFen);
        setLastMoveSquares(optimisticLastMove);
        spawnCaptureRainPiece(baseFen, uciMove);
      }

      setLoading(true);
      resetHints();
      setErrorText(null);

      try {
        const response = await playMove(sessionId, uciMove);
        setState(response.nextState);
        setLastBestMove(response.bestMoveUci ?? null);
        setCorrectText(null);
        let artifactSessionId = sessionId;

        if (response.result === 'incorrect') {
          playMoveSoundDecision(moveSoundDecision, prefs.soundEnabled);
          const fallbackWrongSquare = uciMove.length >= 4 ? (uciMove.slice(2, 4) as Square) : null;
          const markerSquare = optimisticLastMove?.[1] ?? fallbackWrongSquare;
          if (markerSquare && !prefs.oneTryMode) {
            setWrongMoveSquare(markerSquare);
            setWrongMoveFlashToken((previous) => previous + 1);
          }
          if (prefs.oneTryMode) {
            setDisplayFen(response.nextState.fen);
            setLastMoveSquares(null);
            setWrongMoveSquare(null);
            setOneTryFailed(true);

            if (prefs.autoNext) {
              setStatusText('Incorrect. Next puzzle...');
              await maybeWait(SHORT_STATUS_DELAY_MS, prefs.animations);
              const prefetchedNext = takePrefetchedNextSession(sessionId, prefs.variationMode, prefs.autoNext);
              if (prefetchedNext) {
                applyStartedSession(prefetchedNext, 'Incorrect. Next puzzle loaded');
                activatePrefetchedSession(prefetchedNext.sessionId);
                artifactSessionId = prefetchedNext.sessionId;
              } else {
                const next = await nextPuzzle(sessionId, prefs.variationMode, prefs.autoNext);
                applyStartedSession(
                  {
                    sessionId: next.newSessionId,
                    puzzle: next.puzzle,
                    state: next.state,
                    ui: { autoNextDefault: prefs.autoNext }
                  },
                  'Incorrect. Next puzzle loaded'
                );
                artifactSessionId = next.newSessionId;
              }
            } else {
              setStatusText('Incorrect. Press Next puzzle');
            }
          } else {
            setStatusText('Incorrect');
            await maybeWait(WRONG_MOVE_FEEDBACK_MS, prefs.animations);
            setDisplayFen(response.nextState.fen);
            setLastMoveSquares(null);
            setWrongMoveSquare(null);
            setStatusText('Try again');
          }
        } else if (response.result === 'correct') {
          playMoveSoundDecision(moveSoundDecision, prefs.soundEnabled);
          setCorrectText('Correct');
          setStatusText('Correct move');
          await maybeWait(CORRECT_BREAK_MS, prefs.animations);
          if (optimisticLastMove?.[1]) {
            setLineCompleteSquare(optimisticLastMove[1]);
            setLineCompleteFlashToken((previous) => previous + 1);
          }
          await animateAutoPlay(
            response,
            optimisticFen ?? baseFen,
            prefs.animations,
            prefs.soundEnabled
          );
          setStatusText(
            `Correct. Branch ${response.nextState.completedBranches + 1}/${response.nextState.totalLines}`
          );
        } else {
          playMoveSoundDecision(moveSoundDecision, prefs.soundEnabled);
          setCorrectText('Correct');
          setStatusText('Correct move');
          await maybeWait(CORRECT_BREAK_MS, prefs.animations);
          if (optimisticLastMove?.[1]) {
            setLineCompleteSquare(optimisticLastMove[1]);
            setLineCompleteFlashToken((previous) => previous + 1);
          }
          await animateAutoPlay(
            response,
            optimisticFen ?? baseFen,
            prefs.animations,
            prefs.soundEnabled
          );
          setStatusText('Puzzle complete');
          if (prefs.autoNext) {
            await maybeWait(SHORT_STATUS_DELAY_MS, prefs.animations);
            const prefetchedNext = takePrefetchedNextSession(sessionId, prefs.variationMode, prefs.autoNext);
            if (prefetchedNext) {
              applyStartedSession(prefetchedNext, 'Next puzzle loaded');
              activatePrefetchedSession(prefetchedNext.sessionId);
              artifactSessionId = prefetchedNext.sessionId;
            } else {
              const next = await nextPuzzle(sessionId, prefs.variationMode, prefs.autoNext);
              applyStartedSession(
                {
                  sessionId: next.newSessionId,
                  puzzle: next.puzzle,
                  state: next.state,
                  ui: { autoNextDefault: prefs.autoNext }
                },
                'Next puzzle loaded'
              );
              artifactSessionId = next.newSessionId;
            }
          }
        }

        void loadSessionArtifacts(artifactSessionId);
      } catch (error) {
        setWrongMoveSquare(null);
        setErrorText(error instanceof Error ? error.message : 'Move failed');
        setLoading(false);
        return;
      }

      setLoading(false);
    },
    [
      animateAutoPlay,
      applyStartedSession,
      displayFen,
      isReviewMode,
      loadSessionArtifacts,
      loading,
      historyLoading,
      prefs.animations,
      prefs.autoNext,
      prefs.oneTryMode,
      prefs.soundEnabled,
      prefs.variationMode,
      resetHints,
      sessionId,
      spawnCaptureRainPiece,
      state,
      activatePrefetchedSession,
      takePrefetchedNextSession,
      oneTryLocked
    ]
  );

  const handleHint = useCallback(async () => {
    if (!sessionId || loading || historyLoading || isReviewMode || oneTryLocked) {
      return;
    }

    setLoading(true);
    setErrorText(null);
    try {
      const response = await getHint(sessionId);
      const nextHintLevel = response.pieceFromSquare ? Math.min(hintLevel + 1, 2) : 0;
      setHintLevel(nextHintLevel);
      setHintSquare(response.pieceFromSquare);
      setHintArrow(
        nextHintLevel >= 2 && response.bestMoveUci ? getMoveSquares(response.bestMoveUci) : null
      );
      setState(response.state);
      setDisplayFen(response.state.fen);
      setLastMoveSquares(null);
      setWrongMoveSquare(null);
      setLineCompleteSquare(null);
      setStatusText(
        response.pieceFromSquare
          ? nextHintLevel >= 2
            ? 'Hint shown (piece + arrow)'
            : 'Hint shown (piece)'
          : 'No hint available'
      );

      await loadSessionArtifacts(sessionId);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Hint failed');
    } finally {
      setLoading(false);
    }
  }, [hintLevel, isReviewMode, loadSessionArtifacts, loading, historyLoading, sessionId, oneTryLocked]);

  const handleReveal = useCallback(
    async (mode: 'manual' | 'auto' = 'manual') => {
      if (!sessionId || loading || historyLoading || !state || isReviewMode || oneTryLocked) {
        return;
      }

      const baseFen = displayFen ?? state.fen;
      setLoading(true);
      setErrorText(null);
      resetHints();
      try {
        const response = await revealSolution(sessionId, mode);
        setState(response.nextState);
        setLastBestMove(response.bestMoveUci);
        setWrongMoveSquare(null);
        setLineCompleteSquare(null);

        if (!response.bestMoveUci || !response.afterFen) {
          setDisplayFen(response.nextState.fen);
          setLastMoveSquares(null);
          setStatusText(
            isPuzzleSolved(response.nextState) ? 'Puzzle complete' : 'No move to reveal'
          );
          await loadSessionArtifacts(sessionId);
          return;
        }

        const moveSquares = getMoveSquares(response.bestMoveUci);
        if (moveSquares) {
          setLastMoveSquares(moveSquares);
        }

        const moveSoundDecision = getMoveSoundDecision(baseFen, response.bestMoveUci);
        spawnCaptureRainPiece(baseFen, response.bestMoveUci);
        playMoveSoundDecision(moveSoundDecision, prefs.soundEnabled);

        setDisplayFen(response.afterFen);
        setStatusText(
          mode === 'auto'
            ? `Autoplay: ${response.bestMoveUci}`
            : `Best move: ${response.bestMoveUci}`
        );
        await maybeWait(CORRECT_BREAK_MS, prefs.animations);

        await animateAutoPlay(response, response.afterFen, prefs.animations, prefs.soundEnabled);

        if (isPuzzleSolved(response.nextState)) {
          setStatusText('Puzzle complete');
        } else {
          setStatusText(
            mode === 'auto'
              ? `Autoplay. Branch ${response.nextState.completedBranches + 1}/${response.nextState.totalLines}`
              : `Best line. Branch ${response.nextState.completedBranches + 1}/${response.nextState.totalLines}`
          );
        }

        await loadSessionArtifacts(sessionId);
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : 'Reveal failed');
      } finally {
        setLoading(false);
      }
    },
    [
      animateAutoPlay,
      displayFen,
      isReviewMode,
      loadSessionArtifacts,
      loading,
      historyLoading,
      prefs.animations,
      prefs.soundEnabled,
      resetHints,
      sessionId,
      spawnCaptureRainPiece,
      state,
      oneTryLocked
    ]
  );

  const handleSkipVariation = useCallback(async () => {
    if (!sessionId || loading || historyLoading || isReviewMode || oneTryLocked) {
      return;
    }

    setLoading(true);
    setErrorText(null);
    resetHints();
    try {
      const response = await skipVariation(sessionId);
      setState(response.nextState);
      setDisplayFen(response.nextState.fen);
      setLastMoveSquares(null);
      setWrongMoveSquare(null);
      setLineCompleteSquare(null);
      setStatusText(response.skipped ? 'Variation skipped' : 'Nothing to skip');

      await loadSessionArtifacts(sessionId);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Skip variation failed');
    } finally {
      setLoading(false);
    }
  }, [isReviewMode, loadSessionArtifacts, loading, historyLoading, resetHints, sessionId, oneTryLocked]);

  const handleNextPuzzle = useCallback(async () => {
    if (!sessionId || loading || historyLoading) {
      return;
    }

    setLoading(true);
    setErrorText(null);

    try {
      const prefetchedNext = takePrefetchedNextSession(sessionId, prefs.variationMode, prefs.autoNext);
      if (prefetchedNext) {
        applyStartedSession(prefetchedNext, 'New puzzle loaded');
        activatePrefetchedSession(prefetchedNext.sessionId);
      } else {
        const next = await nextPuzzle(sessionId, prefs.variationMode, prefs.autoNext);
        applyStartedSession(
          {
            sessionId: next.newSessionId,
            puzzle: next.puzzle,
            state: next.state,
            ui: { autoNextDefault: prefs.autoNext }
          },
          'New puzzle loaded'
        );
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to load next puzzle');
    } finally {
      setLoading(false);
    }
  }, [
    applyStartedSession,
    loading,
    historyLoading,
    prefs.autoNext,
    prefs.variationMode,
    sessionId,
    activatePrefetchedSession,
    takePrefetchedNextSession
  ]);

  const handleRestartPuzzle = useCallback(async () => {
    if (!puzzle || !state || loading || historyLoading || isReviewMode || !isPuzzleSolved(state)) {
      return;
    }

    setLoading(true);
    setErrorText(null);

    try {
      const response = await startSession(prefs.variationMode, prefs.autoNext, puzzle.publicId);
      applyStartedSession(response, 'Puzzle restarted');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to restart puzzle');
    } finally {
      setLoading(false);
    }
  }, [
    applyStartedSession,
    historyLoading,
    isReviewMode,
    loading,
    prefs.autoNext,
    prefs.variationMode,
    puzzle,
    state
  ]);

  useEffect(() => {
    if (!prefs.autoPlay || !sessionId || !state || loading || historyLoading || isReviewMode || oneTryLocked) {
      return;
    }

    if (isPuzzleSolved(state)) {
      if (prefs.autoNext) {
        void handleNextPuzzle();
      }
      return;
    }

    const timer = window.setTimeout(
      () => {
        void handleReveal('auto');
      },
      prefs.animations ? 450 : NO_ANIMATION_DELAY_MS
    );

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    handleNextPuzzle,
    handleReveal,
    historyLoading,
    isReviewMode,
    loading,
    prefs.animations,
    prefs.autoNext,
    prefs.autoPlay,
    sessionId,
    state,
    oneTryLocked
  ]);

  const hideHistoryPreview = useCallback(() => {
    if (historyPreviewDelayRef.current !== null) {
      window.clearTimeout(historyPreviewDelayRef.current);
      historyPreviewDelayRef.current = null;
    }
    if (mobileHistoryHoldRef.current !== null) {
      window.clearTimeout(mobileHistoryHoldRef.current);
      mobileHistoryHoldRef.current = null;
    }
    historyPreviewRequestRef.current += 1;
    setHistoryPreview(null);
  }, []);

  const updateHistoryPreviewPosition = useCallback((x: number, y: number) => {
    setHistoryPreview((current) => (current ? { ...current, x, y } : current));
  }, []);

  const openHistoryPreview = useCallback(
    (item: SessionHistoryItem, x: number, y: number) => {
      if (historyPreviewDelayRef.current !== null) {
        window.clearTimeout(historyPreviewDelayRef.current);
      }

      historyPreviewDelayRef.current = window.setTimeout(() => {
        historyPreviewDelayRef.current = null;
        const tone = getHistoryDotTone(item);
        const label = getHistoryDotLabel(tone);
        const cached = historyPreviewCacheRef.current.get(item.sessionId);
        if (cached) {
          setHistoryPreview({
            ...cached,
            tone,
            x,
            y,
            loading: false
          });
          return;
        }

        setHistoryPreview({
          sessionId: item.sessionId,
          fen: '',
          puzzleTitle: item.puzzleTitle,
          puzzlePublicId: item.puzzlePublicId,
          createdAt: item.createdAt,
          label,
          tone,
          x,
          y,
          loading: true
        });

        const requestId = ++historyPreviewRequestRef.current;
        void loadSession(item.sessionId)
          .then((response) => {
            if (historyPreviewRequestRef.current !== requestId) {
              return;
            }

            const data = {
              sessionId: item.sessionId,
              fen: response.state.fen,
              puzzleTitle: item.puzzleTitle || response.puzzle.title,
              puzzlePublicId: item.puzzlePublicId,
              createdAt: item.createdAt,
              label
            } satisfies HistoryPreviewData;
            historyPreviewCacheRef.current.set(item.sessionId, data);
            setHistoryPreview((current) =>
              current?.sessionId === item.sessionId
                ? {
                    ...current,
                    ...data,
                    loading: false
                  }
                : current
            );
          })
          .catch(() => {
            if (historyPreviewRequestRef.current !== requestId) {
              return;
            }

            setHistoryPreview((current) =>
              current?.sessionId === item.sessionId ? { ...current, loading: false } : current
            );
          });
      }, HISTORY_PREVIEW_DELAY_MS);
    },
    []
  );

  const handleHistoryDotMouseEnter = useCallback(
    (item: SessionHistoryItem, event: ReactMouseEvent<HTMLDivElement>) => {
      openHistoryPreview(item, event.clientX, event.clientY);
    },
    [openHistoryPreview]
  );

  const handleHistoryDotMouseMove = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    updateHistoryPreviewPosition(event.clientX, event.clientY);
  }, [updateHistoryPreviewPosition]);

  const handleHistoryDotFocus = useCallback(
    (item: SessionHistoryItem, event: ReactFocusEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      openHistoryPreview(item, rect.right, rect.top + rect.height / 2);
    },
    [openHistoryPreview]
  );

  const clearMobileHistoryHold = useCallback(() => {
    if (mobileHistoryHoldRef.current !== null) {
      window.clearTimeout(mobileHistoryHoldRef.current);
      mobileHistoryHoldRef.current = null;
    }
  }, []);

  const handleHistoryDotPointerDown = useCallback(
    (item: SessionHistoryItem, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!isMobileViewport || event.pointerType !== 'touch') {
        return;
      }

      clearMobileHistoryHold();
      mobileHistoryPreviewSessionRef.current = null;

      const rect = event.currentTarget.getBoundingClientRect();
      mobileHistoryHoldRef.current = window.setTimeout(() => {
        mobileHistoryHoldRef.current = null;
        mobileHistoryPreviewSessionRef.current = item.sessionId;
        suppressHistoryDotClickRef.current = item.sessionId;
        openHistoryPreview(item, rect.right, rect.top + rect.height / 2);
      }, MOBILE_HISTORY_PREVIEW_HOLD_MS);
    },
    [clearMobileHistoryHold, isMobileViewport, openHistoryPreview]
  );

  const handleHistoryDotPointerEnd = useCallback(
    (item: SessionHistoryItem, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!isMobileViewport || event.pointerType !== 'touch') {
        return;
      }

      clearMobileHistoryHold();
      if (mobileHistoryPreviewSessionRef.current === item.sessionId) {
        mobileHistoryPreviewSessionRef.current = null;
        hideHistoryPreview();
      }
    },
    [clearMobileHistoryHold, hideHistoryPreview, isMobileViewport]
  );

  const historyPreviewPosition = useMemo(() => {
    if (!historyPreview || typeof window === 'undefined') {
      return null;
    }

    const previewWidth = 336;
    const previewHeight = 426;
    const gap = 18;
    const maxLeft = Math.max(gap, window.innerWidth - previewWidth - gap);
    const maxTop = Math.max(gap, window.innerHeight - previewHeight - gap);

    return {
      left: Math.max(gap, Math.min(historyPreview.x + gap, maxLeft)),
      top: Math.max(gap, Math.min(historyPreview.y + gap, maxTop))
    };
  }, [historyPreview]);

  const handleLoadById = useCallback(async () => {
    if (loading || historyLoading) {
      return;
    }

    const trimmedId = puzzleIdInput.trim();
    if (!trimmedId) {
      setErrorText('Enter a puzzle ID');
      return;
    }

    setLoading(true);
    setErrorText(null);
    resetHints();
    setLastBestMove(null);
    setLastMoveSquares(null);
    setCorrectText(null);
    setReviewPath(null);

    try {
      const response = await startSession(prefs.variationMode, prefs.autoNext, trimmedId);
      applyStartedSession(response, 'Puzzle loaded by ID');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to load puzzle by ID');
      setStatusText('Failed to load puzzle');
    } finally {
      setLoading(false);
    }
  }, [
    applyStartedSession,
    loading,
    historyLoading,
    prefs.autoNext,
    prefs.variationMode,
    puzzleIdInput,
    resetHints
  ]);

  const handleLoadHistorySession = useCallback(
    async (targetSessionId: string) => {
      if (loading || historyLoading) {
        return;
      }

      setHistoryLoading(true);
      setErrorText(null);
      resetHints();
      setLastBestMove(null);
      setLastMoveSquares(null);
      setCorrectText(null);
      setReviewPath(null);

      try {
        const response = await loadSession(targetSessionId);
        applyStartedSession(response, 'Loaded game from history');
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : 'Failed to load history game');
      } finally {
        setHistoryLoading(false);
      }
    },
    [applyStartedSession, loading, historyLoading, resetHints]
  );

  const handleReviewMove = useCallback(
    (node: SessionTreeNode) => {
      if (!state) {
        return;
      }

      setReviewPath((previous) => {
        if (previous && previous.length > 0) {
          const currentNodeId = previous[previous.length - 1];
          if (node.parent_id !== currentNodeId) {
            return previous;
          }
          return [...previous, node.id];
        }

        if (node.parent_id !== state.nodeId) {
          return previous;
        }

        return [state.nodeId, node.id];
      });
    },
    [state]
  );

  const handleReviewBackOne = useCallback(() => {
    setReviewPath((previous) => {
      if (!previous || previous.length <= 2) {
        return null;
      }
      return previous.slice(0, -1);
    });
  }, []);

  const handleBackToLive = useCallback(() => {
    setReviewPath(null);
  }, []);

  const toggleVariationMode = (checked: boolean) => {
    setPrefs((previous) => ({
      ...previous,
      variationMode: checked ? 'explore' : 'mainline'
    }));
  };

  if (!state || !puzzle) {
    return (
      <>
        <main className="loading-minimal">
          <p>Loading...</p>
        </main>
        {errorText ? (
          <p className="global-error-toast" role="alert" aria-live="assertive">
            {errorText}
          </p>
        ) : null}
      </>
    );
  }

  const interactive = boardCanInteract;
  const isZenMode = prefs.zenMode;
  const shellClassName = ['app-shell', isZenMode ? 'is-zen-mode' : null, prefs.showEngineEval ? 'has-eval' : 'no-eval']
    .filter(Boolean)
    .join(' ');
  const footerLinks: AppChromeLink[] = [
    { href: REPO_URL, label: 'GitHub', external: true }
  ];
  const puzzleActionButtons = (
    <>
      <button
        type="button"
        className="btn-secondary"
        disabled={panelControlsDisabled || isReviewMode || !prefs.hintsEnabled}
        onClick={() => void handleHint()}
      >
        Hint
      </button>
      <button
        type="button"
        className="btn-secondary"
        disabled={panelControlsDisabled || isReviewMode}
        onClick={() => void handleReveal()}
      >
        Show solution
      </button>
      {puzzleIsComplete ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={panelControlsDisabled || isReviewMode}
          onClick={() => void handleRestartPuzzle()}
        >
          Restart puzzle
        </button>
      ) : (
        <button
          type="button"
          className="btn-secondary"
          disabled={panelControlsDisabled || isReviewMode}
          onClick={() => void handleSkipVariation()}
        >
          Skip variation
        </button>
      )}
      <button
        type="button"
        className="btn-primary"
        disabled={panelControlsDisabled}
        onClick={() => void handleNextPuzzle()}
      >
        Next puzzle
      </button>
    </>
  );
  const reviewNavigationButtons = (
    <>
      <button type="button" disabled={panelControlsDisabled || !isReviewMode} onClick={handleReviewBackOne}>
        Back one move
      </button>
      <button type="button" disabled={panelControlsDisabled || !isReviewMode} onClick={handleBackToLive}>
        Back to live puzzle
      </button>
    </>
  );
  const zenReviewNavigationButtons = (
    <>
      <button
        type="button"
        className="btn-secondary"
        disabled={panelControlsDisabled || !isReviewMode}
        onClick={handleReviewBackOne}
      >
        Back one move
      </button>
      <button
        type="button"
        className="btn-secondary"
        disabled={panelControlsDisabled || !isReviewMode}
        onClick={handleBackToLive}
      >
        Back to live puzzle
      </button>
    </>
  );

  return (
    <>
      <div className={shellClassName}>
        {isZenMode ? (
          <button
            type="button"
            className="zen-exit-hint"
            onClick={() =>
              setPrefs((previous) => ({
                ...previous,
                zenMode: false
              }))
            }
          >
            Click here or press Esc to exit zen mode
          </button>
        ) : null}
        <div className="capture-rain-layer" aria-hidden="true">
          {fallingCapturePieces.map((piece) => (
            <div
              key={piece.id}
              className="capture-rain-piece"
              style={piece.style}
              onAnimationEnd={(event) => handleCaptureRainPieceAnimationEnd(event, piece.id)}
            >
              <img className="capture-rain-piece-spin" src={piece.src} alt="" />
            </div>
          ))}
        </div>
        <header className="app-header">
          <div className="app-header-inner">
            <div className="app-header-primary">
              <div className="app-brand-lockup">
                <a className="app-brand" href="/" aria-label="chess-web home">
                  chess-web
                </a>
                <p className="app-brand-meta">
                  {puzzleCount === null ? 'Live puzzle count unavailable' : `${COUNT_FORMATTER.format(puzzleCount)} puzzles`}
                </p>
              </div>
              <details ref={headerSettingsRef} className="app-header-settings settings-panel">
                <summary className="settings-summary">Settings</summary>
                <div className="settings-content">
                  <div className="settings-content-body">
                  <section className="settings-section" aria-labelledby="settings-gameplay">
                    <div className="settings-section-head">
                      <span className="settings-section-title" id="settings-gameplay">
                        Gameplay
                      </span>
                    </div>
                    <div className="toggle-chip-grid">
                      <button
                        type="button"
                        className={`toggle-chip ${prefs.variationMode === 'explore' ? 'is-on' : 'is-off'}`}
                        aria-pressed={prefs.variationMode === 'explore'}
                        onClick={() => toggleVariationMode(prefs.variationMode !== 'explore')}
                      >
                        <span className="toggle-chip-text">Explore variations</span>
                        <span className="toggle-chip-track" aria-hidden="true">
                          <span className="toggle-chip-thumb" />
                        </span>
                      </button>

                      <button
                        type="button"
                        className={`toggle-chip ${prefs.autoNext ? 'is-on' : 'is-off'}`}
                        aria-pressed={prefs.autoNext}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            autoNext: !previous.autoNext
                          }))
                        }
                      >
                        <span className="toggle-chip-text">Auto-next puzzle</span>
                        <span className="toggle-chip-track" aria-hidden="true">
                          <span className="toggle-chip-thumb" />
                        </span>
                      </button>

                      <button
                        type="button"
                        className={`toggle-chip ${prefs.hintsEnabled ? 'is-on' : 'is-off'}`}
                        aria-pressed={prefs.hintsEnabled}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            hintsEnabled: !previous.hintsEnabled
                          }))
                        }
                      >
                        <span className="toggle-chip-text">Enable hints</span>
                        <span className="toggle-chip-track" aria-hidden="true">
                          <span className="toggle-chip-thumb" />
                        </span>
                      </button>

                      <button
                        type="button"
                        className={`toggle-chip ${prefs.oneTryMode ? 'is-on' : 'is-off'}`}
                        aria-pressed={prefs.oneTryMode}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            oneTryMode: !previous.oneTryMode
                          }))
                        }
                      >
                        <span className="toggle-chip-text">One try mode</span>
                        <span className="toggle-chip-track" aria-hidden="true">
                          <span className="toggle-chip-thumb" />
                        </span>
                      </button>
                    </div>
                  </section>

                  <section className="settings-section" aria-labelledby="settings-presentation">
                    <div className="settings-section-head">
                      <span className="settings-section-title" id="settings-presentation">
                        Display
                      </span>
                    </div>
                    <div className="toggle-chip-grid">
                      <button
                        type="button"
                        className={`toggle-chip ${prefs.darkMode ? 'is-on' : 'is-off'}`}
                        aria-pressed={prefs.darkMode}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            darkMode: !previous.darkMode
                          }))
                        }
                      >
                        <span className="toggle-chip-text">Dark mode</span>
                        <span className="toggle-chip-track" aria-hidden="true">
                          <span className="toggle-chip-thumb" />
                        </span>
                      </button>

                      <button
                        type="button"
                        className={`toggle-chip ${prefs.zenMode ? 'is-on' : 'is-off'}`}
                        aria-pressed={prefs.zenMode}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            zenMode: !previous.zenMode
                          }))
                        }
                      >
                        <span className="toggle-chip-text">Zen mode</span>
                        <span className="toggle-chip-track" aria-hidden="true">
                          <span className="toggle-chip-thumb" />
                        </span>
                      </button>

                      <button
                        type="button"
                        className={`toggle-chip ${prefs.boardGlass ? 'is-on' : 'is-off'}`}
                        aria-pressed={prefs.boardGlass}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            boardGlass: !previous.boardGlass
                          }))
                        }
                      >
                        <span className="toggle-chip-text">Board glass</span>
                        <span className="toggle-chip-track" aria-hidden="true">
                          <span className="toggle-chip-thumb" />
                        </span>
                      </button>

                      <button
                        type="button"
                        className={`toggle-chip ${prefs.showEngineEval ? 'is-on' : 'is-off'}`}
                        aria-pressed={prefs.showEngineEval}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            showEngineEval: !previous.showEngineEval
                          }))
                        }
                      >
                        <span className="toggle-chip-text">Engine + eval</span>
                        <span className="toggle-chip-track" aria-hidden="true">
                          <span className="toggle-chip-thumb" />
                        </span>
                      </button>
                    </div>
                  </section>

                  <section className="settings-section" aria-labelledby="settings-feedback">
                    <div className="settings-section-head">
                      <span className="settings-section-title" id="settings-feedback">
                        Feedback
                      </span>
                    </div>
                    <div className="toggle-chip-grid">
                      <button
                        type="button"
                        className={`toggle-chip ${prefs.animations ? 'is-on' : 'is-off'}`}
                        aria-pressed={prefs.animations}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            animations: !previous.animations
                          }))
                        }
                      >
                        <span className="toggle-chip-text">Animations</span>
                        <span className="toggle-chip-track" aria-hidden="true">
                          <span className="toggle-chip-thumb" />
                        </span>
                      </button>

                      <button
                        type="button"
                        className={`toggle-chip ${prefs.soundEnabled ? 'is-on' : 'is-off'}`}
                        aria-pressed={prefs.soundEnabled}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            soundEnabled: !previous.soundEnabled
                          }))
                        }
                      >
                        <span className="toggle-chip-text">Sound</span>
                        <span className="toggle-chip-track" aria-hidden="true">
                          <span className="toggle-chip-thumb" />
                        </span>
                      </button>

                      <button
                        type="button"
                        className={`toggle-chip ${prefs.captureRain ? 'is-on' : 'is-off'}`}
                        aria-pressed={prefs.captureRain}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            captureRain: !previous.captureRain
                          }))
                        }
                      >
                        <span className="toggle-chip-text">Capture rain</span>
                        <span className="toggle-chip-track" aria-hidden="true">
                          <span className="toggle-chip-thumb" />
                        </span>
                      </button>
                    </div>
                  </section>

                  <section className="settings-section" aria-labelledby="settings-automation">
                    <div className="settings-section-head">
                      <span className="settings-section-title" id="settings-automation">
                        Automation
                      </span>
                    </div>
                    <div className="toggle-chip-grid">
                      <button
                        type="button"
                        className={`toggle-chip autoplay-chip ${prefs.autoPlay ? 'is-on' : 'is-off'}`}
                        aria-pressed={prefs.autoPlay}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            autoPlay: !previous.autoPlay
                          }))
                        }
                      >
                        <span className="toggle-chip-text">Autoplay puzzles</span>
                        <span className="toggle-chip-track" aria-hidden="true">
                          <span className="toggle-chip-thumb" />
                        </span>
                      </button>

                      <button
                        type="button"
                        className={`toggle-chip ${prefs.autoQueenPromotion ? 'is-on' : 'is-off'}`}
                        aria-pressed={prefs.autoQueenPromotion}
                        onClick={() =>
                          setPrefs((previous) => ({
                            ...previous,
                            autoQueenPromotion: !previous.autoQueenPromotion
                          }))
                        }
                      >
                        <span className="toggle-chip-text">Auto-queen</span>
                        <span className="toggle-chip-track" aria-hidden="true">
                          <span className="toggle-chip-thumb" />
                        </span>
                      </button>
                    </div>
                  </section>

                  <section className="settings-section" aria-labelledby="settings-tools">
                    <div className="settings-section-head">
                      <span className="settings-section-title" id="settings-tools">
                        Tools
                      </span>
                    </div>
                    <div className="id-search-row">
                      <input
                        type="text"
                        value={puzzleIdInput}
                        onChange={(event) => setPuzzleIdInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleLoadById();
                          }
                        }}
                        placeholder="Puzzle ID (UUID)"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        disabled={loading || historyLoading || puzzleIdInput.trim().length === 0}
                        onClick={() => void handleLoadById()}
                      >
                        Load ID
                      </button>
                    </div>
                  </section>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </header>
        <main className="layout split-layout">
          <section className="board-column" id="board">
            <div className={`board-stack ${prefs.showEngineEval ? '' : 'no-eval'}`}>
              <div className="board-stage">
                {prefs.showEngineEval ? (
                  <EvalBar cp={engineEval.cp} mate={engineEval.mate} />
                ) : null}
                <div className="board-shell">
                  <ChessBoard
                    fen={boardFen ?? state.fen}
                    orientation={playerOrientation}
                    checkColor={checkColor}
                    interactive={interactive}
                    canMoveExecution={!loading && !historyLoading}
                    animationsEnabled={prefs.animations}
                    premoveResetToken={sessionId}
                    autoQueenPromotion={prefs.autoQueenPromotion}
                    hintSquare={hintSquare}
                    hintArrow={hintArrow}
                    lastMove={isReviewMode ? reviewLastMoveSquares : lastMoveSquares}
                    wrongMoveSquare={isReviewMode ? null : wrongMoveSquare}
                    wrongMoveFlashToken={wrongMoveFlashToken}
                    lineCompleteSquare={isReviewMode ? null : lineCompleteSquare}
                    lineCompleteFlashToken={lineCompleteFlashToken}
                    glassEnabled={prefs.boardGlass}
                    onMove={(uciMove) => void handleMove(uciMove)}
                  />
                </div>
              </div>
              {isZenMode ? (
                <div className={`zen-controls ${prefs.showEngineEval ? '' : 'no-eval'}`}>
                  <div className="button-row">
                    {puzzleActionButtons}
                    {zenReviewNavigationButtons}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {!isZenMode ? (
            <aside className="side-column panel">
            <section className="rail-block header rail-status">
              <p className={`subtitle rail-title ${!puzzle.title ? 'is-untitled' : ''}`}>
                {puzzle.title || 'Untitled Puzzle'}
              </p>
              <p className="meta rail-id">ID: {puzzle.publicId}</p>
              <div className="rail-status-main">
                <p className="turn-indicator">{turnLabel}</p>
                {prefs.showEngineEval ? (
                  <p className="meta rail-engine">
                    Engine: {engineEvalText} | d{engineEval.depth} | {engineEvalSideText}
                  </p>
                ) : null}
                <p className="status status-line">{statusText}</p>
                <p className="correct correct-line">{correctText ?? '\u00A0'}</p>
              </div>
              <div className="rail-status-footer">
                <p className="meta expected-line">
                  {lastBestMove ? `Expected: ${lastBestMove}` : '\u00A0'}
                </p>
                <p className="meta rail-branch">Completed {state.completedBranches}/{state.totalLines}</p>
                {isReviewMode ? <p className="meta rail-review">Review mode active</p> : null}
              </div>
            </section>

            <section className="rail-block rail-actions">
              <div className="button-row">
                {puzzleActionButtons}
              </div>

            </section>

            <section
              className={`rail-block history-strip ${prefs.autoPlay ? 'is-muted' : ''} ${isMobileViewport ? 'is-mobile' : ''}`}
              id="history"
              aria-label="Recent game history"
            >
              <div className="history-head">
                <p className="history-title">Recent games</p>
                <p className="history-meta">Last {recentHistoryItems.length}</p>
              </div>
              <div className="history-list">
                {recentHistoryItems.map((item) => {
                  const tone = getHistoryDotTone(item);
                  const label = getHistoryDotLabel(tone);
                  const symbol = getHistoryDotSymbol(tone);
                  const selected = item.sessionId === sessionId;
                  return (
                    <div
                      key={item.sessionId}
                      className="history-dot-slot"
                      onMouseEnter={(event) => handleHistoryDotMouseEnter(item, event)}
                      onMouseMove={handleHistoryDotMouseMove}
                      onMouseLeave={hideHistoryPreview}
                      onFocus={(event) => handleHistoryDotFocus(item, event)}
                      onBlur={hideHistoryPreview}
                    >
                      <button
                        type="button"
                        className={`history-dot tone-${tone} ${selected ? 'current' : ''}`}
                        onPointerDown={(event) => handleHistoryDotPointerDown(item, event)}
                        onPointerUp={(event) => handleHistoryDotPointerEnd(item, event)}
                        onPointerCancel={(event) => handleHistoryDotPointerEnd(item, event)}
                        onPointerLeave={(event) => handleHistoryDotPointerEnd(item, event)}
                        onClick={() => {
                          if (suppressHistoryDotClickRef.current === item.sessionId) {
                            suppressHistoryDotClickRef.current = null;
                            return;
                          }
                          void handleLoadHistorySession(item.sessionId);
                        }}
                        disabled={panelControlsDisabled}
                        aria-label={`${selected ? 'Current' : label} puzzle ${item.puzzlePublicId} from history`}
                      >
                        {symbol}
                      </button>
                    </div>
                  );
                })}
              </div>
              {historyError ? <p className="error">{historyError}</p> : null}
            </section>

            <section className="rail-block pgn-panel" id="explorer">
              <div className="pgn-header-row">
                <p className="pgn-title">PGN Explorer</p>
                <div className="pgn-actions">{reviewNavigationButtons}</div>
              </div>

              <p className="meta pgn-path">
                {isReviewMode && reviewMoves.length > 0
                  ? `Path: ${reviewMoves.join(' ')}`
                  : 'Path: Live position'}
              </p>

              {treeError ? <p className="error">{treeError}</p> : null}

              <div className="pgn-move-list">
                {pgnNextMoves.length === 0 ? (
                  <button type="button" className="pgn-move pgn-empty-state" disabled>
                    No legal continuation from this node
                  </button>
                ) : (
                  pgnNextMoves.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      className={`pgn-move ${node.is_mainline ? 'is-mainline' : ''}`}
                      disabled={panelControlsDisabled}
                      onClick={() => handleReviewMove(node)}
                    >
                      <span>{node.san || node.uci}</span>
                      <span>{node.is_mainline ? 'Main' : 'Var'}</span>
                    </button>
                  ))
                )}
              </div>
            </section>
            </aside>
          ) : null}
        </main>
        {historyPreview && historyPreviewPosition ? (
          <aside
            className={`history-preview-card tone-${historyPreview.tone} ${historyPreview.loading ? 'is-loading' : ''}`}
            style={{
              left: `${historyPreviewPosition.left}px`,
              top: `${historyPreviewPosition.top}px`
            }}
            aria-hidden="true"
          >
            <div className="history-preview-head">
              <span className="history-preview-state">{historyPreview.label}</span>
              <span className="history-preview-id">{historyPreview.puzzlePublicId}</span>
            </div>
            <div className="history-preview-board-wrap">
              {historyPreview.loading || !historyPreview.fen ? (
                <div className="history-preview-loading">Loading preview…</div>
              ) : (
                <MiniPreviewBoard
                  fen={historyPreview.fen}
                  orientation={playerOrientation}
                  glassEnabled={prefs.boardGlass}
                />
              )}
            </div>
            <div className="history-preview-meta">
              <p className="history-preview-title">{historyPreview.puzzleTitle || 'Puzzle'}</p>
              <p className="history-preview-time">{new Date(historyPreview.createdAt).toLocaleString()}</p>
            </div>
          </aside>
        ) : null}
        <footer className="app-footer">
          <div className="app-footer-inner">
            <div className="app-footer-links" aria-label="Footer links">
              {footerLinks.map((link) => (
                <a
                  key={link.label}
                  className="app-footer-link"
                  href={link.href}
                  {...(link.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                >
                  {link.label}
                </a>
              ))}
            </div>
            <p className="app-footer-license">GPL-3.0-or-later.</p>
          </div>
        </footer>
      </div>
      {errorText ? (
        <p className="global-error-toast" role="alert" aria-live="assertive">
          {errorText}
        </p>
      ) : null}
    </>
  );
}
