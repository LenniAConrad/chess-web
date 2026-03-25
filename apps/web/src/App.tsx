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
import { getHistoryDotSymbol, getHistoryDotTone } from './lib/historyDots.js';
import { getI18n, LANGUAGE_OPTIONS, type FrontendI18n } from './lib/i18n.js';
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

const AUTO_PLAY_DELAY_MS = 220;
const CORRECT_BREAK_MS = 220;
const REWIND_STEP_DELAY_MS = 220;
const REWIND_BREAK_MS = 160;
const SHORT_STATUS_DELAY_MS = 160;
const CHECK_SOUND_DELAY_MS = 0;
const WRONG_MOVE_FEEDBACK_MS = 220;
const SESSION_HISTORY_FETCH_LIMIT = 100;
const NO_ANIMATION_DELAY_MS = 120;
const MOBILE_HISTORY_PREVIEW_HOLD_MS = 260;
const CAPTURE_RAIN_MAX_PIECES = 64;
const REPO_URL = 'https://github.com/LenniAConrad/chess-web';

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

function getFeedbackDelay(ms: number, animationsEnabled: boolean): number {
  if (ms <= 0) {
    return 0;
  }

  return animationsEnabled ? ms : NO_ANIMATION_DELAY_MS;
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

interface TerminalEvalDisplay {
  cp: null;
  mate: number;
  text: string;
  sideText: string;
  depthText: string;
}

function getTerminalEvalDisplay(fen: string | null, i18n: FrontendI18n): TerminalEvalDisplay | null {
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

function formatEngineEval(
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

function formatEngineSide(
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

function appendSimilarVariationStatus(
  base: string,
  skippedSimilarVariations: number,
  i18n: FrontendI18n
): string {
  if (skippedSimilarVariations <= 0) {
    return base;
  }

  return `${base}. ${i18n.similarVariationsSkipped(skippedSimilarVariations)}`;
}

type UiMessage =
  | { kind: 'literal'; value: string }
  | { kind: 'translated'; resolve: (i18n: FrontendI18n) => string };

function literalUiMessage(value: string): UiMessage {
  return { kind: 'literal', value };
}

function translatedUiMessage(resolve: (i18n: FrontendI18n) => string): UiMessage {
  return { kind: 'translated', resolve };
}

function resolveUiMessage(message: UiMessage | null, i18n: FrontendI18n): string | null {
  if (!message) {
    return null;
  }

  return message.kind === 'literal' ? message.value : message.resolve(i18n);
}

export function App() {
  /**
   * `App` is the session orchestrator for the full UI:
   * - manages API-driven puzzle/session state
   * - drives board/status animations and sound decisions
   * - coordinates history + PGN explorer + settings persistence
   */
  const { prefs, setPrefs } = useLocalPrefs();
  const i18n = useMemo(() => getI18n(prefs.language), [prefs.language]);
  const i18nRef = useRef(i18n);
  const countFormatter = useMemo(() => new Intl.NumberFormat(i18n.locale), [i18n.locale]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [puzzle, setPuzzle] = useState<PuzzleHeader | null>(null);
  const [state, setState] = useState<SessionStatePayload | null>(null);
  const [displayFen, setDisplayFen] = useState<string | null>(null);
  const [premoveResetCounter, setPremoveResetCounter] = useState(0);
  const [statusMessage, setStatusMessage] = useState<UiMessage>(() =>
    translatedUiMessage((copy) => copy.loadingPuzzle)
  );
  const [correctMessage, setCorrectMessage] = useState<UiMessage | null>(null);
  const [errorMessage, setErrorMessage] = useState<UiMessage | null>(null);
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
  const [historyErrorMessage, setHistoryErrorMessage] = useState<UiMessage | null>(null);
  const [sessionTree, setSessionTree] = useState<SessionTreeResponse | null>(null);
  const [treeErrorMessage, setTreeErrorMessage] = useState<UiMessage | null>(null);
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
  const headerLanguageRef = useRef<HTMLDetailsElement | null>(null);
  const capturePieceIdRef = useRef(0);
  const historyPreviewCacheRef = useRef(new Map<string, HistoryPreviewData>());
  const historyPreviewDelayRef = useRef<number | null>(null);
  const historyPreviewRequestRef = useRef(0);
  const mobileHistoryHoldRef = useRef<number | null>(null);
  const mobileHistoryPointerIdRef = useRef<number | null>(null);
  const mobileHistoryPendingSessionRef = useRef<string | null>(null);
  const mobileHistoryPreviewSessionRef = useRef<string | null>(null);
  const suppressHistoryDotClickRef = useRef<string | null>(null);
  const sessionArtifactsRequestRef = useRef(0);
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

  useEffect(() => {
    i18nRef.current = i18n;
  }, [i18n]);

  useEffect(() => {
    historyPreviewCacheRef.current.clear();
    setHistoryPreview((current) =>
      current ? { ...current, label: i18n.historyDotLabels[current.tone] ?? i18n.historyDotLabels.unknown } : current
    );
  }, [i18n]);

  const statusText = useMemo(
    () => resolveUiMessage(statusMessage, i18n) ?? '\u00A0',
    [i18n, statusMessage]
  );
  const correctText = useMemo(
    () => resolveUiMessage(correctMessage, i18n),
    [correctMessage, i18n]
  );
  const errorText = useMemo(
    () => resolveUiMessage(errorMessage, i18n),
    [errorMessage, i18n]
  );
  const historyError = useMemo(
    () => resolveUiMessage(historyErrorMessage, i18n),
    [historyErrorMessage, i18n]
  );
  const treeError = useMemo(
    () => resolveUiMessage(treeErrorMessage, i18n),
    [treeErrorMessage, i18n]
  );

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
  const recentHistoryItemMap = useMemo(
    () => new Map(recentHistoryItems.map((item) => [item.sessionId, item])),
    [recentHistoryItems]
  );

  const engineEval = useStockfishEval(boardFen, prefs.showEngineEval);
  const terminalEvalDisplay = useMemo(() => getTerminalEvalDisplay(boardFen, i18n), [boardFen, i18n]);
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
    return turn === 'w' ? i18n.whiteToMove : i18n.blackToMove;
  })();

  const displayedEngineCp = terminalEvalDisplay?.cp ?? engineEval.cp;
  const displayedEngineMate = terminalEvalDisplay?.mate ?? engineEval.mate;
  const displayedEngineError = terminalEvalDisplay ? null : engineEval.error;
  const engineEvalText =
    terminalEvalDisplay?.text ?? formatEngineEval(displayedEngineCp, displayedEngineMate, displayedEngineError, i18n);
  const engineEvalSideText =
    terminalEvalDisplay?.sideText ??
    formatEngineSide(displayedEngineCp, displayedEngineMate, displayedEngineError, i18n);
  const engineDepthText = terminalEvalDisplay?.depthText ?? `d${engineEval.depth}`;
  const getDelay = useCallback((ms: number) => ms, []);
  const getFeedbackPause = useCallback((ms: number, animationsEnabled: boolean) => getFeedbackDelay(ms, animationsEnabled), []);

  const resetHints = useCallback(() => {
    setHintSquare(null);
    setHintArrow(null);
    setHintLevel(0);
  }, []);

  const resetPremoves = useCallback(() => {
    setPremoveResetCounter((current) => current + 1);
  }, []);

  const loadSessionArtifacts = useCallback(async (activeSessionId: string) => {
    const requestId = ++sessionArtifactsRequestRef.current;

    try {
      const [history, tree] = await Promise.all([
        getSessionHistory(activeSessionId, SESSION_HISTORY_FETCH_LIMIT, true),
        getSessionTree(activeSessionId)
      ]);

      if (sessionArtifactsRequestRef.current !== requestId) {
        return;
      }

      setHistoryItems(history.items);
      setHistoryErrorMessage(null);
      setSessionTree(tree);
      setTreeErrorMessage(null);
    } catch (error) {
      if (sessionArtifactsRequestRef.current !== requestId) {
        return;
      }

      const message =
        error instanceof Error
          ? literalUiMessage(error.message)
          : translatedUiMessage((copy) => copy.failedToLoadPuzzleMetadata);
      setTreeErrorMessage(message);
      setHistoryErrorMessage(message);
    }
  }, [i18n.failedToLoadPuzzleMetadata]);

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.darkMode ? 'dark' : 'light';
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [prefs.darkMode]);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

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

  const closeHeaderMenus = useCallback((keepOpen: 'settings' | 'language' | null = null) => {
    if (keepOpen !== 'settings' && headerSettingsRef.current?.open) {
      headerSettingsRef.current.open = false;
    }

    if (keepOpen !== 'language' && headerLanguageRef.current?.open) {
      headerLanguageRef.current.open = false;
    }
  }, []);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const settingsEl = headerSettingsRef.current;
      const languageEl = headerLanguageRef.current;

      if (settingsEl?.open && !settingsEl.contains(target)) {
        settingsEl.open = false;
      }

      if (languageEl?.open && !languageEl.contains(target)) {
        languageEl.open = false;
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
    (response: StartSessionResponse, status: UiMessage) => {
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
      setCorrectMessage(null);
      setReviewPath(null);
      setSessionTree(null);
      setWrongMoveSquare(null);
      setLineCompleteSquare(null);
      setOneTryFailed(false);
      resetPremoves();
      setStatusMessage(status);
    },
    [resetHints, resetPremoves]
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

      setFallingCapturePieces((previous) => [...previous.slice(-(CAPTURE_RAIN_MAX_PIECES - 1)), piece]);
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
        resetPremoves();
        setStatusMessage(translatedUiMessage((copy) => copy.correctRewinding));
        await wait(getFeedbackPause(CORRECT_BREAK_MS, animationsEnabled));
        setLineCompleteSquare(null);
        for (const fen of rewindFens) {
          setLastMoveSquares(getMoveSquaresBetweenFens(fen, rewindSourceFen));
          setDisplayFen(fen);
          rewindSourceFen = fen;
          await maybeWait(getDelay(REWIND_STEP_DELAY_MS), animationsEnabled);
        }
        await maybeWait(getDelay(REWIND_BREAK_MS), animationsEnabled);
      }

      if (!response.autoPlayStartFen || response.autoPlayedMoves.length === 0) {
        setDisplayFen(response.nextState.fen);
        return null;
      }

      const currentOrRewoundFen = rewindSourceFen;
      if (currentOrRewoundFen !== response.autoPlayStartFen) {
        setDisplayFen(response.autoPlayStartFen);
        await maybeWait(getDelay(REWIND_STEP_DELAY_MS), animationsEnabled);
      }

      setStatusMessage(translatedUiMessage((copy) => copy.correctOpponentResponse));
      const chess = new Chess(response.autoPlayStartFen);
      let finalMoveSquares: [Square, Square] | null = null;
      await maybeWait(getDelay(AUTO_PLAY_DELAY_MS), animationsEnabled);

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
          await maybeWait(getDelay(AUTO_PLAY_DELAY_MS), animationsEnabled);
        }
      }

      setDisplayFen(response.nextState.fen);
      return finalMoveSquares;
    },
    [getDelay, resetPremoves, spawnCaptureRainPiece]
  );

  const loadInitial = useCallback(async () => {
    const currentI18n = i18nRef.current;
    setLoading(true);
    setErrorMessage(null);
    setHistoryErrorMessage(null);
    setTreeErrorMessage(null);
    resetHints();
    setLastBestMove(null);
    setLastMoveSquares(null);
    setReviewPath(null);

    try {
      const response = await startSession(prefs.variationMode, prefs.autoNext);
      applyStartedSession(response, literalUiMessage('\u00A0'));
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? literalUiMessage(error.message)
          : translatedUiMessage((copy) => copy.failedToLoadPuzzle)
      );
      setStatusMessage(translatedUiMessage((copy) => copy.failedToLoadPuzzle));
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
        playMoveSoundDecision(moveSoundDecision, prefs.soundEnabled);
      }

      setLoading(true);
      resetHints();
      setErrorMessage(null);

      try {
        const response = await playMove(sessionId, uciMove, prefs.skipSimilarVariations);
        setState(response.nextState);
        setLastBestMove(response.bestMoveUci ?? null);
        setCorrectMessage(null);
        let artifactSessionId = sessionId;

        if (response.result === 'incorrect') {
          const fallbackWrongSquare = uciMove.length >= 4 ? (uciMove.slice(2, 4) as Square) : null;
          const markerSquare = optimisticLastMove?.[1] ?? fallbackWrongSquare;
          if (markerSquare && !prefs.oneTryMode) {
            setWrongMoveSquare(markerSquare);
            setWrongMoveFlashToken((previous) => previous + 1);
          }
          if (prefs.oneTryMode) {
            resetPremoves();
            setDisplayFen(response.nextState.fen);
            setLastMoveSquares(null);
            setWrongMoveSquare(null);
            setOneTryFailed(true);

            if (prefs.autoNext) {
              setStatusMessage(translatedUiMessage((copy) => copy.incorrectNextPuzzle));
              await maybeWait(getDelay(SHORT_STATUS_DELAY_MS), prefs.animations);
              const prefetchedNext = takePrefetchedNextSession(sessionId, prefs.variationMode, prefs.autoNext);
              if (prefetchedNext) {
                applyStartedSession(prefetchedNext, translatedUiMessage((copy) => copy.incorrectNextPuzzle));
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
                  translatedUiMessage((copy) => copy.incorrectNextPuzzle)
                );
                artifactSessionId = next.newSessionId;
              }
            } else {
              setStatusMessage(translatedUiMessage((copy) => copy.incorrectPressNextPuzzle));
            }
          } else {
            setStatusMessage(translatedUiMessage((copy) => copy.incorrect));
            await wait(getFeedbackPause(WRONG_MOVE_FEEDBACK_MS, prefs.animations));
            resetPremoves();
            setDisplayFen(response.nextState.fen);
            setLastMoveSquares(null);
            setWrongMoveSquare(null);
            setStatusMessage(translatedUiMessage((copy) => copy.tryAgain));
          }
        } else if (response.result === 'correct') {
          if (response.rewindFens.length > 0 && optimisticLastMove?.[1]) {
            setLineCompleteSquare(optimisticLastMove[1]);
            setLineCompleteFlashToken((previous) => previous + 1);
          }
          setCorrectMessage(translatedUiMessage((copy) => copy.correct));
          setStatusMessage(translatedUiMessage((copy) => copy.correctMove));
          if (response.rewindFens.length === 0) {
            await wait(getFeedbackPause(CORRECT_BREAK_MS, prefs.animations));
          }
          await animateAutoPlay(
            response,
            optimisticFen ?? baseFen,
            prefs.animations,
            prefs.soundEnabled
          );
          setStatusMessage(
            translatedUiMessage((copy) =>
              appendSimilarVariationStatus(
                copy.correctBranchStatus(
                  response.nextState.completedBranches + 1,
                  response.nextState.totalLines
                ),
                response.skippedSimilarVariations,
                copy
              )
            )
          );
        } else {
          if (optimisticLastMove?.[1]) {
            setLineCompleteSquare(optimisticLastMove[1]);
            setLineCompleteFlashToken((previous) => previous + 1);
          }
          setCorrectMessage(translatedUiMessage((copy) => copy.correct));
          setStatusMessage(translatedUiMessage((copy) => copy.correctMove));
          if (response.rewindFens.length === 0) {
            await wait(getFeedbackPause(CORRECT_BREAK_MS, prefs.animations));
          }
          await animateAutoPlay(
            response,
            optimisticFen ?? baseFen,
            prefs.animations,
            prefs.soundEnabled
          );
          setStatusMessage(
            translatedUiMessage((copy) =>
              appendSimilarVariationStatus(
                copy.puzzleComplete,
                response.skippedSimilarVariations,
                copy
              )
            )
          );
          if (prefs.autoNext) {
            await maybeWait(getDelay(SHORT_STATUS_DELAY_MS), prefs.animations);
            const prefetchedNext = takePrefetchedNextSession(sessionId, prefs.variationMode, prefs.autoNext);
            if (prefetchedNext) {
              applyStartedSession(prefetchedNext, translatedUiMessage((copy) => copy.newPuzzleLoaded));
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
                translatedUiMessage((copy) => copy.newPuzzleLoaded)
              );
              artifactSessionId = next.newSessionId;
            }
          }
        }

        void loadSessionArtifacts(artifactSessionId);
      } catch (error) {
        setWrongMoveSquare(null);
        setErrorMessage(
          error instanceof Error
            ? literalUiMessage(error.message)
            : translatedUiMessage((copy) => copy.moveFailed)
        );
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
      getDelay,
      getFeedbackPause,
      prefs.animations,
      prefs.autoNext,
      prefs.oneTryMode,
      prefs.skipSimilarVariations,
      prefs.soundEnabled,
      prefs.variationMode,
      resetHints,
      sessionId,
      spawnCaptureRainPiece,
      state,
      activatePrefetchedSession,
      takePrefetchedNextSession,
      i18n,
      oneTryLocked,
      resetPremoves
    ]
  );

  const handleHint = useCallback(async () => {
    if (!sessionId || loading || historyLoading || isReviewMode || oneTryLocked) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await getHint(sessionId);
      const nextHintLevel = response.pieceFromSquare ? Math.min(hintLevel + 1, 2) : 0;
      setHintLevel(nextHintLevel);
      setHintSquare(response.pieceFromSquare);
      setHintArrow(
        nextHintLevel >= 2 && response.bestMoveUci ? getMoveSquares(response.bestMoveUci) : null
      );
      setState(response.state);
      resetPremoves();
      setDisplayFen(response.state.fen);
      setLastMoveSquares(null);
      setWrongMoveSquare(null);
      setLineCompleteSquare(null);
      setStatusMessage(
        translatedUiMessage((copy) =>
          response.pieceFromSquare
            ? nextHintLevel >= 2
              ? copy.hintShownPieceAndArrow
              : copy.hintShownPiece
            : copy.noHintAvailable
        )
      );

      void loadSessionArtifacts(sessionId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? literalUiMessage(error.message)
          : translatedUiMessage((copy) => copy.hintFailed)
      );
    } finally {
      setLoading(false);
    }
  }, [
    hintLevel,
    i18n,
    isReviewMode,
    loadSessionArtifacts,
    loading,
    historyLoading,
    resetPremoves,
    sessionId,
    oneTryLocked
  ]);

  const handleReveal = useCallback(
    async (mode: 'manual' | 'auto' = 'manual') => {
      if (!sessionId || loading || historyLoading || !state || isReviewMode || oneTryLocked) {
        return;
      }

      const baseFen = displayFen ?? state.fen;
      setLoading(true);
      setErrorMessage(null);
      resetHints();
      try {
        const response = await revealSolution(sessionId, mode, prefs.skipSimilarVariations);
        setState(response.nextState);
        setLastBestMove(response.bestMoveUci);
        setWrongMoveSquare(null);
        setLineCompleteSquare(null);

        if (!response.bestMoveUci || !response.afterFen) {
          resetPremoves();
          setDisplayFen(response.nextState.fen);
          setLastMoveSquares(null);
          setStatusMessage(
            translatedUiMessage((copy) =>
              isPuzzleSolved(response.nextState) ? copy.puzzleComplete : copy.noMoveToReveal
            )
          );
          void loadSessionArtifacts(sessionId);
          return;
        }

        const moveSquares = getMoveSquares(response.bestMoveUci);
        if (moveSquares) {
          setLastMoveSquares(moveSquares);
          if (mode === 'auto') {
            setLineCompleteSquare(moveSquares[1]);
            setLineCompleteFlashToken((previous) => previous + 1);
          }
        }

        const moveSoundDecision = getMoveSoundDecision(baseFen, response.bestMoveUci);
        spawnCaptureRainPiece(baseFen, response.bestMoveUci);
        playMoveSoundDecision(moveSoundDecision, prefs.soundEnabled);
        const revealedMove = response.bestMoveUci;

        setDisplayFen(response.afterFen);
        setStatusMessage(
          translatedUiMessage((copy) =>
            mode === 'auto' ? copy.autoplayMove(revealedMove) : copy.bestMove(revealedMove)
          )
        );
        await wait(getFeedbackPause(CORRECT_BREAK_MS, prefs.animations));

        await animateAutoPlay(response, response.afterFen, prefs.animations, prefs.soundEnabled);

        if (isPuzzleSolved(response.nextState)) {
          setStatusMessage(
            translatedUiMessage((copy) =>
              appendSimilarVariationStatus(
                copy.puzzleComplete,
                response.skippedSimilarVariations,
                copy
              )
            )
          );
        } else {
          setStatusMessage(
            translatedUiMessage((copy) =>
              appendSimilarVariationStatus(
                mode === 'auto'
                  ? copy.autoplayBranchStatus(
                      response.nextState.completedBranches + 1,
                      response.nextState.totalLines
                    )
                  : copy.bestLineBranchStatus(
                      response.nextState.completedBranches + 1,
                      response.nextState.totalLines
                    ),
                response.skippedSimilarVariations,
                copy
              )
            )
          );
        }

        void loadSessionArtifacts(sessionId);
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? literalUiMessage(error.message)
            : translatedUiMessage((copy) => copy.revealFailed)
        );
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
      getDelay,
      getFeedbackPause,
      prefs.animations,
      prefs.skipSimilarVariations,
      prefs.soundEnabled,
      resetHints,
      resetPremoves,
      sessionId,
      spawnCaptureRainPiece,
      state,
      i18n,
      oneTryLocked
    ]
  );

  const handleSkipVariation = useCallback(async () => {
    if (!sessionId || loading || historyLoading || isReviewMode || oneTryLocked) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    resetHints();
    try {
      const response = await skipVariation(sessionId, prefs.skipSimilarVariations);
      setState(response.nextState);
      resetPremoves();
      setDisplayFen(response.nextState.fen);
      setLastMoveSquares(null);
      setWrongMoveSquare(null);
      setLineCompleteSquare(null);
      setStatusMessage(
        translatedUiMessage((copy) =>
          response.skipped
            ? appendSimilarVariationStatus(
                copy.variationSkipped,
                response.skippedSimilarVariations,
                copy
              )
            : copy.nothingToSkip
        )
      );

      void loadSessionArtifacts(sessionId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? literalUiMessage(error.message)
          : translatedUiMessage((copy) => copy.skipVariationFailed)
      );
    } finally {
      setLoading(false);
    }
  }, [
    isReviewMode,
    loadSessionArtifacts,
    loading,
    historyLoading,
    prefs.skipSimilarVariations,
    resetHints,
    resetPremoves,
    sessionId,
    i18n,
    oneTryLocked
  ]);

  const handleNextPuzzle = useCallback(async () => {
    if (!sessionId || loading || historyLoading) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const prefetchedNext = takePrefetchedNextSession(sessionId, prefs.variationMode, prefs.autoNext);
      if (prefetchedNext) {
        applyStartedSession(prefetchedNext, translatedUiMessage((copy) => copy.newPuzzleLoaded));
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
          translatedUiMessage((copy) => copy.newPuzzleLoaded)
        );
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? literalUiMessage(error.message)
          : translatedUiMessage((copy) => copy.failedToLoadNextPuzzle)
      );
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
    takePrefetchedNextSession,
    i18n
  ]);

  const handleRestartPuzzle = useCallback(async () => {
    if (!puzzle || !state || loading || historyLoading || isReviewMode || !isPuzzleSolved(state)) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await startSession(prefs.variationMode, prefs.autoNext, puzzle.publicId);
      applyStartedSession(response, translatedUiMessage((copy) => copy.puzzleRestarted));
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? literalUiMessage(error.message)
          : translatedUiMessage((copy) => copy.failedToLoadPuzzle)
      );
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
    state,
    i18n
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

    const timer = window.setTimeout(() => {
      void handleReveal('auto');
    }, getFeedbackPause(AUTO_PLAY_DELAY_MS, prefs.animations));

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    handleNextPuzzle,
    handleReveal,
    historyLoading,
    isReviewMode,
    loading,
    getFeedbackPause,
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
    (item: SessionHistoryItem, x: number, y: number, immediate = false) => {
      if (historyPreviewDelayRef.current !== null) {
        window.clearTimeout(historyPreviewDelayRef.current);
      }

      const showPreview = () => {
        const tone = getHistoryDotTone(item);
        const label = i18n.historyDotLabels[tone] ?? i18n.historyDotLabels.unknown;
        const requestId = ++historyPreviewRequestRef.current;
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
      };

      if (immediate) {
        historyPreviewDelayRef.current = null;
        showPreview();
        return;
      }

      historyPreviewDelayRef.current = window.setTimeout(() => {
        historyPreviewDelayRef.current = null;
        showPreview();
      }, HISTORY_PREVIEW_DELAY_MS);
    },
    [i18n.historyDotLabels]
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
    mobileHistoryPendingSessionRef.current = null;
  }, []);

  const queueMobileHistoryPreview = useCallback(
    (item: SessionHistoryItem, x: number, y: number) => {
      clearMobileHistoryHold();
      mobileHistoryPendingSessionRef.current = item.sessionId;
      mobileHistoryHoldRef.current = window.setTimeout(() => {
        mobileHistoryHoldRef.current = null;
        if (mobileHistoryPendingSessionRef.current !== item.sessionId) {
          return;
        }
        mobileHistoryPendingSessionRef.current = null;
        mobileHistoryPreviewSessionRef.current = item.sessionId;
        suppressHistoryDotClickRef.current = item.sessionId;
        openHistoryPreview(item, x, y, true);
      }, MOBILE_HISTORY_PREVIEW_HOLD_MS);
    },
    [clearMobileHistoryHold, openHistoryPreview]
  );

  const getHistoryItemAtPoint = useCallback(
    (x: number, y: number) => {
      if (typeof document === 'undefined') {
        return null;
      }

      const target = document.elementFromPoint(x, y);
      if (!(target instanceof Element)) {
        return null;
      }

      const button = target.closest('button.history-dot[data-history-session-id]');
      const sessionId = button?.getAttribute('data-history-session-id');
      if (!sessionId) {
        return null;
      }

      return recentHistoryItemMap.get(sessionId) ?? null;
    },
    [recentHistoryItemMap]
  );

  const handleHistoryDotPointerDown = useCallback(
    (item: SessionHistoryItem, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!isMobileViewport || event.pointerType !== 'touch') {
        return;
      }

      mobileHistoryPointerIdRef.current = event.pointerId;
      mobileHistoryPreviewSessionRef.current = null;
      queueMobileHistoryPreview(item, event.clientX, event.clientY);
    },
    [isMobileViewport, queueMobileHistoryPreview]
  );

  const handleHistoryDotPointerEnd = useCallback(
    (_item: SessionHistoryItem, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!isMobileViewport || event.pointerType !== 'touch') {
        return;
      }

      if (mobileHistoryPointerIdRef.current !== null && event.pointerId !== mobileHistoryPointerIdRef.current) {
        return;
      }

      mobileHistoryPointerIdRef.current = null;
      clearMobileHistoryHold();
      if (mobileHistoryPreviewSessionRef.current !== null) {
        mobileHistoryPreviewSessionRef.current = null;
        hideHistoryPreview();
      }
    },
    [clearMobileHistoryHold, hideHistoryPreview, isMobileViewport]
  );

  useEffect(() => {
    if (!isMobileViewport) {
      mobileHistoryPointerIdRef.current = null;
      clearMobileHistoryHold();
      mobileHistoryPreviewSessionRef.current = null;
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || event.pointerId !== mobileHistoryPointerIdRef.current) {
        return;
      }

      const item = getHistoryItemAtPoint(event.clientX, event.clientY);
      if (!item) {
        clearMobileHistoryHold();
        if (mobileHistoryPreviewSessionRef.current !== null) {
          mobileHistoryPreviewSessionRef.current = null;
          hideHistoryPreview();
        }
        return;
      }

      if (mobileHistoryPreviewSessionRef.current === item.sessionId) {
        updateHistoryPreviewPosition(event.clientX, event.clientY);
        return;
      }

      if (mobileHistoryPreviewSessionRef.current !== null) {
        mobileHistoryPreviewSessionRef.current = item.sessionId;
        suppressHistoryDotClickRef.current = item.sessionId;
        openHistoryPreview(item, event.clientX, event.clientY, true);
        return;
      }

      if (mobileHistoryPendingSessionRef.current !== item.sessionId) {
        queueMobileHistoryPreview(item, event.clientX, event.clientY);
      }
    };

    const handlePointerFinish = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || event.pointerId !== mobileHistoryPointerIdRef.current) {
        return;
      }

      mobileHistoryPointerIdRef.current = null;
      clearMobileHistoryHold();
      if (mobileHistoryPreviewSessionRef.current !== null) {
        mobileHistoryPreviewSessionRef.current = null;
        hideHistoryPreview();
      }
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerFinish);
    document.addEventListener('pointercancel', handlePointerFinish);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerFinish);
      document.removeEventListener('pointercancel', handlePointerFinish);
    };
  }, [
    clearMobileHistoryHold,
    getHistoryItemAtPoint,
    hideHistoryPreview,
    isMobileViewport,
    openHistoryPreview,
    queueMobileHistoryPreview,
    updateHistoryPreviewPosition
  ]);

  const historyPreviewPosition = useMemo(() => {
    if (!historyPreview || typeof window === 'undefined') {
      return null;
    }

    const isMobile = window.innerWidth <= 900;
    const previewWidth = isMobile ? 214 : 336;
    const previewHeight = isMobile ? 282 : 426;
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
      setErrorMessage(translatedUiMessage((copy) => copy.enterPuzzleId));
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    resetHints();
    setLastBestMove(null);
    setLastMoveSquares(null);
    setCorrectMessage(null);
    setReviewPath(null);

    try {
      const response = await startSession(prefs.variationMode, prefs.autoNext, trimmedId);
      applyStartedSession(response, translatedUiMessage((copy) => copy.puzzleLoadedById));
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? literalUiMessage(error.message)
          : translatedUiMessage((copy) => copy.failedToLoadPuzzleById)
      );
      setStatusMessage(translatedUiMessage((copy) => copy.failedToLoadPuzzle));
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
    resetHints,
    i18n
  ]);

  const handleLoadHistorySession = useCallback(
    async (targetSessionId: string) => {
      if (loading || historyLoading) {
        return;
      }

      setHistoryLoading(true);
      setErrorMessage(null);
      resetHints();
      setLastBestMove(null);
      setLastMoveSquares(null);
      setCorrectMessage(null);
      setReviewPath(null);

      try {
        const response = await loadSession(targetSessionId);
        applyStartedSession(response, translatedUiMessage((copy) => copy.loadedGameFromHistory));
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? literalUiMessage(error.message)
            : translatedUiMessage((copy) => copy.failedToLoadHistoryGame)
        );
      } finally {
        setHistoryLoading(false);
      }
    },
    [applyStartedSession, loading, historyLoading, resetHints, i18n]
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
          <p>{i18n.loading}</p>
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
    { href: REPO_URL, label: i18n.github, external: true }
  ];
  const puzzleActionButtons = (
    <>
      <button
        type="button"
        className="btn-secondary"
        disabled={panelControlsDisabled || isReviewMode || !prefs.hintsEnabled}
        onClick={() => void handleHint()}
      >
        {i18n.hint}
      </button>
      <button
        type="button"
        className="btn-secondary"
        disabled={panelControlsDisabled || isReviewMode}
        onClick={() => void handleReveal()}
      >
        {i18n.showSolution}
      </button>
      {puzzleIsComplete ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={panelControlsDisabled || isReviewMode}
          onClick={() => void handleRestartPuzzle()}
        >
          {i18n.restartPuzzle}
        </button>
      ) : (
        <button
          type="button"
          className="btn-secondary"
          disabled={panelControlsDisabled || isReviewMode}
          onClick={() => void handleSkipVariation()}
        >
          {i18n.skipVariation}
        </button>
      )}
      <button
        type="button"
        className="btn-primary"
        disabled={panelControlsDisabled}
        onClick={() => void handleNextPuzzle()}
      >
        {i18n.nextPuzzle}
      </button>
    </>
  );
  const reviewNavigationButtons = (
    <>
      <button type="button" disabled={panelControlsDisabled || !isReviewMode} onClick={handleReviewBackOne}>
        {i18n.backOneMove}
      </button>
      <button type="button" disabled={panelControlsDisabled || !isReviewMode} onClick={handleBackToLive}>
        {i18n.backToLivePuzzle}
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
        {i18n.backOneMove}
      </button>
      <button
        type="button"
        className="btn-secondary"
        disabled={panelControlsDisabled || !isReviewMode}
        onClick={handleBackToLive}
      >
        {i18n.backToLivePuzzle}
      </button>
    </>
  );
  const promotionPieceLabels = {
    q: i18n.promoteTo(i18n.promotionPieceNames.q),
    r: i18n.promoteTo(i18n.promotionPieceNames.r),
    b: i18n.promoteTo(i18n.promotionPieceNames.b),
    n: i18n.promoteTo(i18n.promotionPieceNames.n)
  } as const;

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
            {i18n.exitZenModeHint}
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
                <a className="app-brand" href="/" aria-label={i18n.homeAriaLabel}>
                  chess-web
                </a>
                <p className="app-brand-meta">
                  {puzzleCount === null ? i18n.livePuzzleCountUnavailable : i18n.puzzleCount(countFormatter.format(puzzleCount))}
                </p>
              </div>
              <div className="app-header-controls">
                <details
                  ref={headerLanguageRef}
                  className="app-header-settings app-header-language settings-panel"
                  onToggle={(event) => {
                    if (event.currentTarget.open) {
                      closeHeaderMenus('language');
                    }
                  }}
                >
                  <summary className="settings-summary">{i18n.languageLabel}</summary>
                  <div className="settings-content">
                    <div className="settings-content-body">
                      <section className="settings-section" aria-labelledby="settings-language">
                        <div className="settings-section-head">
                          <span className="settings-section-title" id="settings-language">
                            {i18n.languageLabel}
                          </span>
                        </div>
                        <div className="language-option-grid" role="group" aria-label={i18n.languageLabel}>
                          {LANGUAGE_OPTIONS.map((option) => (
                            <button
                              key={option.code}
                              type="button"
                              className={`language-option ${prefs.language === option.code ? 'is-active' : ''}`}
                              aria-pressed={prefs.language === option.code}
                              onClick={() => {
                                setPrefs((previous) => ({
                                  ...previous,
                                  language: option.code
                                }));
                                if (headerLanguageRef.current) {
                                  headerLanguageRef.current.open = false;
                                }
                              }}
                            >
                              {i18n.languageNames[option.code]}
                            </button>
                          ))}
                        </div>
                      </section>
                    </div>
                  </div>
                </details>

                <details
                  ref={headerSettingsRef}
                  className="app-header-settings settings-panel"
                  onToggle={(event) => {
                    if (event.currentTarget.open) {
                      closeHeaderMenus('settings');
                    }
                  }}
                >
                  <summary className="settings-summary">{i18n.settings}</summary>
                  <div className="settings-content">
                    <div className="settings-content-body">
                      <section className="settings-section" aria-labelledby="settings-gameplay">
                        <div className="settings-section-head">
                          <span className="settings-section-title" id="settings-gameplay">
                            {i18n.gameplay}
                          </span>
                        </div>
                        <div className="toggle-chip-grid">
                          <button
                            type="button"
                            className={`toggle-chip ${prefs.variationMode === 'explore' ? 'is-on' : 'is-off'}`}
                            aria-pressed={prefs.variationMode === 'explore'}
                            onClick={() => toggleVariationMode(prefs.variationMode !== 'explore')}
                          >
                            <span className="toggle-chip-text">{i18n.exploreVariations}</span>
                            <span className="toggle-chip-track" aria-hidden="true">
                              <span className="toggle-chip-thumb" />
                            </span>
                          </button>

                          <button
                            type="button"
                            className={`toggle-chip ${prefs.skipSimilarVariations ? 'is-on' : 'is-off'}`}
                            aria-pressed={prefs.skipSimilarVariations}
                            onClick={() =>
                              setPrefs((previous) => ({
                                ...previous,
                                skipSimilarVariations: !previous.skipSimilarVariations
                              }))
                            }
                          >
                            <span className="toggle-chip-text">{i18n.skipSimilarVariations}</span>
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
                            <span className="toggle-chip-text">{i18n.autoNextPuzzle}</span>
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
                            <span className="toggle-chip-text">{i18n.enableHints}</span>
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
                            <span className="toggle-chip-text">{i18n.oneTryMode}</span>
                            <span className="toggle-chip-track" aria-hidden="true">
                              <span className="toggle-chip-thumb" />
                            </span>
                          </button>
                        </div>
                      </section>

                      <section className="settings-section" aria-labelledby="settings-presentation">
                        <div className="settings-section-head">
                          <span className="settings-section-title" id="settings-presentation">
                            {i18n.display}
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
                            <span className="toggle-chip-text">{i18n.darkMode}</span>
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
                            <span className="toggle-chip-text">{i18n.zenMode}</span>
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
                            <span className="toggle-chip-text">{i18n.boardGlass}</span>
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
                            <span className="toggle-chip-text">{i18n.engineEval}</span>
                            <span className="toggle-chip-track" aria-hidden="true">
                              <span className="toggle-chip-thumb" />
                            </span>
                          </button>
                        </div>
                      </section>

                      <section className="settings-section" aria-labelledby="settings-feedback">
                        <div className="settings-section-head">
                          <span className="settings-section-title" id="settings-feedback">
                            {i18n.feedback}
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
                            <span className="toggle-chip-text">{i18n.animations}</span>
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
                            <span className="toggle-chip-text">{i18n.sound}</span>
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
                            <span className="toggle-chip-text">{i18n.captureRain}</span>
                            <span className="toggle-chip-track" aria-hidden="true">
                              <span className="toggle-chip-thumb" />
                            </span>
                          </button>
                        </div>
                      </section>

                      <section className="settings-section" aria-labelledby="settings-automation">
                        <div className="settings-section-head">
                          <span className="settings-section-title" id="settings-automation">
                            {i18n.automation}
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
                            <span className="toggle-chip-text">{i18n.autoplayPuzzles}</span>
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
                            <span className="toggle-chip-text">{i18n.autoQueen}</span>
                            <span className="toggle-chip-track" aria-hidden="true">
                              <span className="toggle-chip-thumb" />
                            </span>
                          </button>
                        </div>
                      </section>

                      <section className="settings-section" aria-labelledby="settings-tools">
                        <div className="settings-section-head">
                          <span className="settings-section-title" id="settings-tools">
                            {i18n.tools}
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
                            placeholder={i18n.puzzleIdPlaceholder}
                            spellCheck={false}
                          />
                          <button
                            type="button"
                            disabled={loading || historyLoading || puzzleIdInput.trim().length === 0}
                            onClick={() => void handleLoadById()}
                          >
                            {i18n.loadId}
                          </button>
                        </div>
                      </section>
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </div>
        </header>
        <main className="layout split-layout">
          <section className="board-column" id="board">
            <div className={`board-stack ${prefs.showEngineEval ? '' : 'no-eval'}`}>
              <div className="board-stage">
                {prefs.showEngineEval ? (
                  <EvalBar cp={displayedEngineCp} mate={displayedEngineMate} />
                ) : null}
                <div className="board-shell">
                  <ChessBoard
                    fen={boardFen ?? state.fen}
                    orientation={playerOrientation}
                    checkColor={checkColor}
                    interactive={interactive}
                    canMoveExecution={!loading && !historyLoading}
                    animationsEnabled={prefs.animations}
                    premoveResetToken={sessionId ? `${sessionId}:${premoveResetCounter}` : null}
                    autoQueenPromotion={prefs.autoQueenPromotion}
                    hintSquare={hintSquare}
                    hintArrow={hintArrow}
                    lastMove={isReviewMode ? reviewLastMoveSquares : lastMoveSquares}
                    wrongMoveSquare={isReviewMode ? null : wrongMoveSquare}
                    wrongMoveFlashToken={wrongMoveFlashToken}
                    lineCompleteSquare={isReviewMode ? null : lineCompleteSquare}
                    lineCompleteFlashToken={lineCompleteFlashToken}
                    glassEnabled={prefs.boardGlass}
                    promotionDialogLabel={i18n.choosePromotionPiece}
                    cancelPromotionLabel={i18n.cancelPromotion}
                    promotionPieceLabels={promotionPieceLabels}
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
                {puzzle.title || i18n.untitledPuzzle}
              </p>
              <p className="meta rail-id">{i18n.puzzleId(puzzle.publicId)}</p>
              <div className="rail-status-main">
                <p className="turn-indicator">{turnLabel}</p>
                {prefs.showEngineEval ? (
                  <p className="meta rail-engine">
                    {i18n.engineLine(engineEvalText, engineDepthText, engineEvalSideText)}
                  </p>
                ) : null}
                <p className="status status-line">{statusText}</p>
                <p className="correct correct-line">{correctText ?? '\u00A0'}</p>
              </div>
              <div className="rail-status-footer">
                <p className="meta expected-line">
                  {lastBestMove ? i18n.expectedMove(lastBestMove) : '\u00A0'}
                </p>
                <p className="meta rail-branch">{i18n.completedBranches(state.completedBranches, state.totalLines)}</p>
                {isReviewMode ? <p className="meta rail-review">{i18n.reviewModeActive}</p> : null}
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
              aria-label={i18n.recentGameHistory}
            >
              <div className="history-head">
                <p className="history-title">{i18n.recentGames}</p>
                <p className="history-meta">{i18n.historyCount(recentHistoryItems.length)}</p>
              </div>
              <div className="history-list">
                {recentHistoryItems.map((item) => {
                  const tone = getHistoryDotTone(item);
                  const label = i18n.historyDotLabels[tone] ?? i18n.historyDotLabels.unknown;
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
                        data-history-session-id={item.sessionId}
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
                        aria-label={i18n.historyItemAriaLabel(selected, label, item.puzzlePublicId)}
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
                <p className="pgn-title">{i18n.pgnExplorer}</p>
                <div className="pgn-actions">{reviewNavigationButtons}</div>
              </div>

              <p className="meta pgn-path">
                {isReviewMode && reviewMoves.length > 0
                  ? i18n.pathMoves(reviewMoves.join(' '))
                  : i18n.pathLivePosition}
              </p>

              {treeError ? <p className="error">{treeError}</p> : null}

              <div className="pgn-move-list">
                {pgnNextMoves.length === 0 ? (
                  <button type="button" className="pgn-move pgn-empty-state" disabled>
                    {i18n.noLegalContinuation}
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
                      <span>{node.is_mainline ? i18n.mainLine : i18n.variationLine}</span>
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
                <div className="history-preview-loading">{i18n.loadingPreview}</div>
              ) : (
                <MiniPreviewBoard
                  fen={historyPreview.fen}
                  orientation={playerOrientation}
                  glassEnabled={prefs.boardGlass}
                />
              )}
            </div>
            <div className="history-preview-meta">
              <p className="history-preview-title">{historyPreview.puzzleTitle || i18n.puzzleFallback}</p>
              <p className="history-preview-time">{new Date(historyPreview.createdAt).toLocaleString(i18n.locale)}</p>
            </div>
          </aside>
        ) : null}
        <footer className="app-footer">
          <div className="app-footer-inner">
            <div className="app-footer-links" aria-label={i18n.footerLinks}>
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
