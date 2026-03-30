import { type AnimationEvent as ReactAnimationEvent, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { ChessBoard } from './components/ChessBoard.js';
import { AppHeader } from './components/AppHeader.js';
import { CaptureRainLayer, getPromotionPieceLabels, LoadingScreen, PuzzleActionButtons, ReviewNavigationButtons, TransportControlIcon, ZenExitHint } from './components/AppUiBits.js';
import { EvalBar } from './components/EvalBar.js';
import { MiniPreviewBoard } from './components/MiniPreviewBoard.js';
import { useLocalPrefs } from './hooks/useLocalPrefs.js';
import { useStockfishEval } from './hooks/useStockfishEval.js';
import { getHistoryDotSymbol, getHistoryDotTone } from './lib/historyDots.js';
import { getI18n } from './lib/i18n.js';
import { appendSimilarVariationStatus, applyUciMove, AUTO_PLAY_DELAY_MS, type AutoPlayAnimationPayload, type AppChromeLink, CAPTURE_RAIN_MAX_PIECES, CORRECT_BREAK_MS, type FallingCapturePiece, formatEngineEval, formatEngineSide, formatUciMoveAsSan, getCapturedPieceSkin, getFeedbackDelay, getFenAfterUciMove, getMoveSoundDecision, getMoveSquares, getMoveSquaresBetweenFens, getTerminalEvalDisplay, HISTORY_PREVIEW_DELAY_MS, type HistoryPreviewData, type HistoryPreviewState, isPuzzleSolved, literalUiMessage, MOBILE_HISTORY_PREVIEW_HOLD_MS, maybeWait, type PrefetchedNextState, type PuzzleHeader, randomBetween, REPO_URL, resolveUiMessage, REWIND_BREAK_MS, REWIND_STEP_DELAY_MS, scaleAnimationDuration, SESSION_HISTORY_FETCH_LIMIT, SHORT_STATUS_DELAY_MS, translatedUiMessage, type UiMessage, wait, withBasePath, WRONG_MOVE_FEEDBACK_MS, playMoveSoundDecision } from './lib/appShared.js';
import { cacheLoadedSession, getPuzzleCount, getHint, loadSession, refreshSession, getSessionHistory, getSessionTree, nextPuzzle, prefetchNextPuzzle, playMove, restartSession, retainLoadedSessions, revealSolution, startSession } from './lib/api.js';
import { primeMoveSounds } from './lib/moveSounds.js';
import type { HintPreview, SessionHistoryItem, SessionStatePayload, SessionTreeNode, SessionTreeResponse, StartSessionResponse } from './types/api.js';

const ACTIVE_SESSION_COOKIE = 'active_sid';
const ACTIVE_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const INITIAL_LOAD_RETRY_DELAYS_MS = [1500, 3000, 5000, 8000] as const;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let initialSessionRequest: Promise<StartSessionResponse> | null = null;

interface PreparedHintState extends HintPreview {
  nodeId: number;
}

interface ReviewCursorState {
  path: number[];
  index: number;
}

function buildNodePath(nodeMap: Map<number, SessionTreeNode>, nodeId: number): number[] {
  const path: number[] = [];
  const seen = new Set<number>();
  let currentId: number | null = nodeId;

  while (currentId !== null && !seen.has(currentId)) {
    seen.add(currentId);
    path.push(currentId);
    currentId = nodeMap.get(currentId)?.parent_id ?? null;
  }

  path.reverse();
  return path;
}

function pathsMatch(left: number[], right: number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((nodeId, index) => nodeId === right[index]);
}

function normalizeTitleText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function isUntitledPuzzleTitle(title: string, localizedUntitledTitle: string): boolean {
  const normalizedTitle = normalizeTitleText(title);
  if (normalizedTitle.length === 0) {
    return true;
  }

  const lowerTitle = normalizedTitle.toLocaleLowerCase();
  const lowerLocalizedUntitledTitle = normalizeTitleText(localizedUntitledTitle).toLocaleLowerCase();

  return (
    lowerTitle === 'untitled' ||
    lowerTitle === 'untitled puzzle' ||
    lowerTitle.startsWith('untitled puzzle ') ||
    lowerTitle === lowerLocalizedUntitledTitle
  );
}

type SanPieceLetter = 'K' | 'Q' | 'R' | 'B' | 'N';

const SAN_PIECE_IMAGE_URLS = {
  wK: withBasePath('pieces/cburnett/wK.svg'),
  wQ: withBasePath('pieces/cburnett/wQ.svg'),
  wR: withBasePath('pieces/cburnett/wR.svg'),
  wB: withBasePath('pieces/cburnett/wB.svg'),
  wN: withBasePath('pieces/cburnett/wN.svg'),
  bK: withBasePath('pieces/cburnett/bK.svg'),
  bQ: withBasePath('pieces/cburnett/bQ.svg'),
  bR: withBasePath('pieces/cburnett/bR.svg'),
  bB: withBasePath('pieces/cburnett/bB.svg'),
  bN: withBasePath('pieces/cburnett/bN.svg')
} as const;

let sanPiecePreloadLinksInjected = false;
let sanPieceImagesPrimed = false;
const primedSanPieceImages: HTMLImageElement[] = [];

function primeSanPieceImages(): void {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return;
  }

  const urls = Object.values(SAN_PIECE_IMAGE_URLS);

  if (!sanPiecePreloadLinksInjected) {
    sanPiecePreloadLinksInjected = true;

    for (const href of urls) {
      const existing = document.head.querySelector(`link[rel="preload"][as="image"][href="${href}"]`);
      if (existing) {
        continue;
      }

      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      link.href = href;
      document.head.append(link);
    }
  }

  if (sanPieceImagesPrimed) {
    return;
  }

  sanPieceImagesPrimed = true;

  for (const href of urls) {
    const image = new Image();
    image.decoding = 'async';
    image.src = href;
    primedSanPieceImages.push(image);
  }
}

function getSanPieceImageSrc(piece: SanPieceLetter, ply: number): string | null {
  const color = ply % 2 === 1 ? 'w' : 'b';
  return SAN_PIECE_IMAGE_URLS[`${color}${piece}` as keyof typeof SAN_PIECE_IMAGE_URLS] ?? null;
}

function buildMoveTextParts(moveText: string, ply: number, renderPieceImages: boolean): Array<string | JSX.Element> {
  if (!renderPieceImages) {
    return [moveText];
  }

  const parts: Array<string | JSX.Element> = [];
  let cursor = 0;
  let imageIndex = 0;

  for (const match of moveText.matchAll(/(^[KQRBN])|=([QRBN])/g)) {
    const index = match.index ?? 0;
    const piece = (match[1] ?? match[2]) as SanPieceLetter;
    const isPromotion = Boolean(match[2]);

    if (index > cursor) {
      parts.push(moveText.slice(cursor, index));
    }

    if (isPromotion) {
      parts.push('=');
    }

    const imageSrc = getSanPieceImageSrc(piece, ply);
    if (imageSrc) {
      parts.push(<img key={`piece-${imageIndex}`} className="san-piece-icon" src={imageSrc} alt="" aria-hidden="true" />);
      imageIndex += 1;
    } else {
      parts.push(piece);
    }

    cursor = index + (isPromotion ? 2 : 1);
  }

  if (cursor < moveText.length) {
    parts.push(moveText.slice(cursor));
  }

  return parts;
}

function MoveText(props: { moveText: string; ply: number; renderPieceImages: boolean; className?: string }) {
  const { moveText, ply, renderPieceImages, className } = props;
  const moveClassName = ['san-move-text', className].filter(Boolean).join(' ');

  return <span className={moveClassName} aria-label={moveText}>{buildMoveTextParts(moveText, ply, renderPieceImages)}</span>;
}

function formatNodeMoveText(node: SessionTreeNode): string {
  return node.san || node.uci;
}

function getPgnMovePrefix(node: SessionTreeNode): string {
  const moveNumber = Math.ceil(node.ply / 2);
  return node.ply % 2 === 1 ? `${moveNumber}.` : `${moveNumber}...`;
}

function formatPgnMoveLabel(node: SessionTreeNode): string {
  return `${getPgnMovePrefix(node)} ${formatNodeMoveText(node)}`;
}

function readActiveSessionIdCookie(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const cookie = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${ACTIVE_SESSION_COOKIE}=`));

  if (!cookie) {
    return null;
  }

  const value = decodeURIComponent(cookie.slice(ACTIVE_SESSION_COOKIE.length + 1));
  return UUID_REGEX.test(value) ? value : null;
}

function writeActiveSessionIdCookie(sessionId: string): void {
  if (typeof document === 'undefined' || !UUID_REGEX.test(sessionId)) {
    return;
  }

  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    `${ACTIVE_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; Max-Age=${ACTIVE_SESSION_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

function clearActiveSessionIdCookie(): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.cookie = `${ACTIVE_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function getInitialSession(mode: StartSessionResponse['state']['variationMode'], autoNext: boolean): Promise<StartSessionResponse> {
  if (initialSessionRequest) {
    return initialSessionRequest;
  }

  initialSessionRequest = (async () => {
    const activeSessionId = readActiveSessionIdCookie();
    if (activeSessionId) {
      try {
        return await loadSession(activeSessionId);
      } catch {
        clearActiveSessionIdCookie();
      }
    }

    return startSession(mode, autoNext);
  })().finally(() => {
    initialSessionRequest = null;
  });

  return initialSessionRequest;
}

export function App() {
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
  const [lastMoveSquares, setLastMoveSquares] = useState<[Square, Square] | null>(null);
  const [puzzleIdInput, setPuzzleIdInput] = useState('');
  const [historyItems, setHistoryItems] = useState<SessionHistoryItem[]>([]);
  const [historyErrorMessage, setHistoryErrorMessage] = useState<UiMessage | null>(null);
  const [sessionTree, setSessionTree] = useState<SessionTreeResponse | null>(null);
  const [treeErrorMessage, setTreeErrorMessage] = useState<UiMessage | null>(null);
  const [preparedHint, setPreparedHint] = useState<PreparedHintState | null>(null);
  const [reviewCursor, setReviewCursor] = useState<ReviewCursorState | null>(null);
  const [wrongMoveSquare, setWrongMoveSquare] = useState<Square | null>(null);
  const [wrongMoveFlashToken, setWrongMoveFlashToken] = useState(0);
  const [lineCompleteSquare, setLineCompleteSquare] = useState<Square | null>(null);
  const [lineCompleteFlashToken, setLineCompleteFlashToken] = useState(0);
  const [fallingCapturePieces, setFallingCapturePieces] = useState<FallingCapturePiece[]>([]);
  const [oneTryFailed, setOneTryFailed] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<HistoryPreviewState | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const mobileSecondaryScreenRef = useRef<HTMLElement | null>(null);
  const mobileHeaderRef = useRef<HTMLElement | null>(null);
  const mobilePrimaryPageBodyRef = useRef<HTMLElement | null>(null);
  const mobileControlsPanelRef = useRef<HTMLElement | null>(null);
  const mobileEvalWrapRef = useRef<HTMLDivElement | null>(null);
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
  const mobileButtonScrollTopRef = useRef<number | null>(null);
  const mobileSnapTouchStartYRef = useRef<number | null>(null);
  const mobileSnapTouchStartScrollTopRef = useRef<number | null>(null);
  const mobileSnapLockedRef = useRef(false);
  const mobileSnapUnlockTimeoutRef = useRef<number | null>(null);
  const sessionArtifactsRequestRef = useRef(0);
  const hintSyncRequestRef = useRef(0);
  const prefetchedNextRef = useRef<PrefetchedNextState | null>(null);
  const prefetchedNextRequestRef = useRef(0);
  const autoPlaySolveStateRef = useRef<{ sessionId: string | null; solved: boolean }>({
    sessionId: null,
    solved: false
  });
  const previousAutoNextRef = useRef(prefs.autoNext);
  const initialPrefsRef = useRef({
    autoNext: prefs.autoNext,
    variationMode: prefs.variationMode
  });
  const initialLoadRetryAttemptRef = useRef(0);
  const recentHistoryItems = historyItems;
  const isZenMode = prefs.zenMode;
  const isMobileStandardLayout = isMobileViewport && !isZenMode;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const visualViewport = window.visualViewport;
    const syncViewport = () => {
      const viewportWidth = visualViewport?.width ?? window.innerWidth;
      const viewportHeight = visualViewport?.height ?? window.innerHeight;
      const isPortraitViewport = viewportHeight >= viewportWidth;
      setIsMobileViewport(viewportWidth <= 900 && isPortraitViewport);
    };

    syncViewport();
    window.addEventListener('resize', syncViewport);
    window.addEventListener('orientationchange', syncViewport);
    visualViewport?.addEventListener('resize', syncViewport);

    return () => {
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('orientationchange', syncViewport);
      visualViewport?.removeEventListener('resize', syncViewport);
    };
  }, []);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    if (appShellRef.current) {
      appShellRef.current.scrollTop = 0;
    }

    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
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
    if (!prefs.renderPgnPieceSvgs) {
      return;
    }

    primeSanPieceImages();
  }, [prefs.renderPgnPieceSvgs]);

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
  const hasStatusText = statusText.trim().length > 0;
  const correctText = useMemo(
    () => resolveUiMessage(correctMessage, i18n),
    [correctMessage, i18n]
  );
  const hasCorrectText = Boolean(correctText?.trim());
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

  const livePath = useMemo(() => {
    if (!state) {
      return [];
    }

    const path = buildNodePath(treeNodeMap, state.nodeId);
    return path.length > 0 ? path : [state.nodeId];
  }, [state, treeNodeMap]);

  const pgnDisplayPath = reviewCursor?.path ?? livePath;
  const activeReviewPath = reviewCursor ? reviewCursor.path.slice(0, reviewCursor.index + 1) : livePath;
  const currentReviewNodeId = activeReviewPath.at(-1) ?? state?.nodeId ?? null;
  const isReviewMode = Boolean(reviewCursor);
  const reviewNode = currentReviewNodeId ? (treeNodeMap.get(currentReviewNodeId) ?? null) : null;
  const reviewFen = isReviewMode ? (reviewNode?.fen_after ?? null) : null;
  const liveFen = displayFen ?? state?.fen ?? null;
  const boardFen = reviewFen ?? liveFen;
  const objectiveFen = reviewFen ?? state?.fen ?? null;
  const reviewLastMoveSquares = useMemo(() => {
    if (!isReviewMode || activeReviewPath.length < 2) {
      return null;
    }

    const nodeId = activeReviewPath[activeReviewPath.length - 1];
    if (!nodeId) {
      return null;
    }

    const node = treeNodeMap.get(nodeId);
    if (!node?.uci) {
      return null;
    }

    return getMoveSquares(node.uci);
  }, [activeReviewPath, isReviewMode, treeNodeMap]);

  const pgnCurrentNodeId = currentReviewNodeId;
  const pgnNextMoves = pgnCurrentNodeId ? (treeChildrenMap.get(pgnCurrentNodeId) ?? []) : [];
  const canRequestContinuation = useMemo(() => {
    if (isReviewMode) {
      return false;
    }

    if (!sessionTree) {
      return true;
    }

    return pgnNextMoves.length > 0;
  }, [isReviewMode, pgnNextMoves.length, sessionTree]);
  const pgnLineNodes = useMemo(
    () =>
      pgnDisplayPath
        .slice(1)
        .map((nodeId) => treeNodeMap.get(nodeId) ?? null)
        .filter((node): node is SessionTreeNode => Boolean(node)),
    [pgnDisplayPath, treeNodeMap]
  );
  const canReviewBackward = useMemo(() => {
    if (livePath.length > 1 && !isReviewMode) {
      return true;
    }

    return Boolean(reviewCursor && reviewCursor.index > 0);
  }, [isReviewMode, livePath.length, reviewCursor]);
  const canReviewForward = useMemo(() => {
    if (!reviewCursor) {
      return false;
    }

    return reviewCursor.index < reviewCursor.path.length - 1;
  }, [reviewCursor]);
  const recentHistoryItemMap = useMemo(
    () => new Map(recentHistoryItems.map((item) => [item.sessionId, item])),
    [recentHistoryItems]
  );
  const currentHistoryIndex = useMemo(
    () => recentHistoryItems.findIndex((item) => item.sessionId === sessionId),
    [recentHistoryItems, sessionId]
  );
  const previousPuzzleSessionId = useMemo(() => {
    if (currentHistoryIndex >= 0) {
      return recentHistoryItems[currentHistoryIndex + 1]?.sessionId ?? null;
    }

    return recentHistoryItems[0]?.sessionId ?? null;
  }, [currentHistoryIndex, recentHistoryItems]);
  const nextHistoryPuzzleSessionId = useMemo(() => {
    if (currentHistoryIndex > 0) {
      return recentHistoryItems[currentHistoryIndex - 1]?.sessionId ?? null;
    }

    return null;
  }, [currentHistoryIndex, recentHistoryItems]);

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
  const objectiveColor = (() => {
    if (!objectiveFen) {
      return null;
    }

    return new Chess(objectiveFen).turn() === 'w' ? 'white' : 'black';
  })();
  const playerOrientation = useMemo<'white' | 'black'>(() => {
    if (!puzzle) {
      return 'white';
    }

    try {
      return new Chess(puzzle.startFen).turn() === 'w' ? 'white' : 'black';
    } catch {
      return 'white';
    }
  }, [puzzle]);
  const puzzleComplete = state ? isPuzzleSolved(state) : false;
  const turnKickerText = puzzleComplete ? '\u00A0' : i18n.yourTurn;
  const objectiveText = puzzleComplete
    ? i18n.puzzleComplete
    : objectiveColor === 'white'
      ? i18n.findBestMoveForWhite
      : objectiveColor === 'black'
        ? i18n.findBestMoveForBlack
        : '\u00A0';
  const reviewModeInlineText = isReviewMode ? 'Reviewing line' : null;
  const hideSolvedStatusPill = !reviewModeInlineText && puzzleComplete && statusText.trim() === i18n.puzzleComplete;
  const displayStatusText = reviewModeInlineText ?? (hideSolvedStatusPill ? '\u00A0' : statusText);
  const hasDisplayStatusText = displayStatusText.trim().length > 0;

  const displayedEngineCp = terminalEvalDisplay?.cp ?? engineEval.cp;
  const displayedEngineMate = terminalEvalDisplay?.mate ?? engineEval.mate;
  const displayedEngineError = terminalEvalDisplay ? null : engineEval.error;
  const engineEvalText =
    terminalEvalDisplay?.text ?? formatEngineEval(displayedEngineCp, displayedEngineMate, displayedEngineError, i18n);
  const engineEvalSideText =
    terminalEvalDisplay?.sideText ??
    formatEngineSide(displayedEngineCp, displayedEngineMate, displayedEngineError, i18n);
  const engineDepthText = terminalEvalDisplay?.depthText ?? `d${engineEval.depth}`;
  const getDelay = useCallback((ms: number) => scaleAnimationDuration(ms, prefs.animationSpeed), [prefs.animationSpeed]);
  const getFeedbackPause = useCallback(
    (ms: number, animationsEnabled: boolean) => getFeedbackDelay(ms, animationsEnabled, prefs.animationSpeed),
    [prefs.animationSpeed]
  );
  const boardAnimationDurationMs = getDelay(200);

  const resetHints = useCallback(() => {
    setHintSquare(null);
    setHintArrow(null);
    setHintLevel(0);
  }, []);

  const resetPremoves = useCallback(() => {
    setPremoveResetCounter((current) => current + 1);
  }, []);

  const setPreparedHintForNode = useCallback(
    (nodeId: number, hintPreview: HintPreview | null | undefined) => {
      if (!hintPreview) {
        setPreparedHint(null);
        return;
      }

      setPreparedHint({
        nodeId,
        pieceFromSquare: hintPreview.pieceFromSquare,
        bestMoveUci: hintPreview.bestMoveUci
      });
    },
    []
  );

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
    document.documentElement.style.setProperty('--board-hue-rotate', `${prefs.boardHue}deg`);
    document.documentElement.style.setProperty('--background-hue-rotate', `${prefs.backgroundHue}deg`);

    return () => {
      document.documentElement.style.removeProperty('--board-hue-rotate');
      document.documentElement.style.removeProperty('--background-hue-rotate');
    };
  }, [prefs.backgroundHue, prefs.boardHue]);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
    document.documentElement.dir = 'ltr';
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
        autoNextDefault: prefs.autoNext,
        hintPreview:
          preparedHint?.nodeId === state.nodeId
            ? {
                pieceFromSquare: preparedHint.pieceFromSquare,
                bestMoveUci: preparedHint.bestMoveUci
              }
            : null
      }
    });
  }, [prefs.autoNext, preparedHint, puzzle, sessionId, state]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    writeActiveSessionIdCookie(sessionId);
  }, [sessionId]);

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
    if (!isMobileViewport) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const button = target.closest('button');
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        return;
      }
      mobileButtonScrollTopRef.current = appShellRef.current?.scrollTop ?? 0;
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const button = target.closest('button');
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }

      window.requestAnimationFrame(() => {
        const shell = appShellRef.current;
        if (shell && mobileButtonScrollTopRef.current !== null) {
          shell.scrollTop = mobileButtonScrollTopRef.current;
        }
        button.blur();
        mobileButtonScrollTopRef.current = null;
      });
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('click', handleClick, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('click', handleClick, true);
    };
  }, [isMobileViewport]);

  useEffect(() => {
    const menus = [headerSettingsRef.current, headerLanguageRef.current].filter(
      (menu): menu is HTMLDetailsElement => Boolean(menu)
    );

    if (menus.length === 0) {
      return;
    }

    const cleanups = menus.map((menu) => {
      const content = menu.querySelector<HTMLDivElement>('.settings-content');
      const scrollTarget = (isMobileViewport ? menu : content) ?? menu;
      const summary = menu.querySelector<HTMLElement>('.settings-summary');

      const syncContentHeight = () => {
        if (!isMobileViewport || !menu.open || !summary) {
          menu.style.removeProperty('--mobile-settings-content-height');
          menu.style.removeProperty('--mobile-settings-summary-height');
          return;
        }

        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const summaryHeight = summary.getBoundingClientRect().height;
        menu.style.setProperty('--mobile-settings-summary-height', `${summaryHeight}px`);
        menu.style.setProperty(
          '--mobile-settings-content-height',
          `${Math.max(0, viewportHeight - summaryHeight)}px`
        );
      };

      const syncScrolledState = () => {
        if (!isMobileViewport || !menu.open) {
          menu.dataset.mobileScrolled = 'false';
          return;
        }

        menu.dataset.mobileScrolled = scrollTarget.scrollTop > 6 ? 'true' : 'false';
      };

      const handleToggle = () => {
        if (!menu.open) {
          menu.dataset.mobileScrolled = 'false';
          menu.style.removeProperty('--mobile-settings-content-height');
          menu.style.removeProperty('--mobile-settings-summary-height');
          return;
        }

        requestAnimationFrame(() => {
          syncContentHeight();
          syncScrolledState();
        });
      };

      const handleResize = () => {
        syncContentHeight();
        syncScrolledState();
      };

      scrollTarget.addEventListener('scroll', syncScrolledState, { passive: true });
      menu.addEventListener('toggle', handleToggle);
      window.addEventListener('resize', handleResize);
      window.visualViewport?.addEventListener('resize', handleResize);
      syncContentHeight();
      syncScrolledState();

      return () => {
        scrollTarget.removeEventListener('scroll', syncScrolledState);
        menu.removeEventListener('toggle', handleToggle);
        window.removeEventListener('resize', handleResize);
        window.visualViewport?.removeEventListener('resize', handleResize);
        menu.style.removeProperty('--mobile-settings-content-height');
        menu.style.removeProperty('--mobile-settings-summary-height');
        delete menu.dataset.mobileScrolled;
      };
    });

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [isMobileViewport]);

  useEffect(() => {
    const shell = appShellRef.current;
    const primaryBody = mobilePrimaryPageBodyRef.current;

    if (!shell || !primaryBody || !isMobileStandardLayout) {
      shell?.style.removeProperty('--mobile-primary-board-max-size');
      return;
    }

    let frameId: number | null = null;

    const measureVisibleHeight = (element: HTMLElement | null): number => {
      if (!element) {
        return 0;
      }

      const computedStyle = window.getComputedStyle(element);
      if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') {
        return 0;
      }

      return element.getBoundingClientRect().height;
    };

    const updateBoardSize = () => {
      const computedStyle = window.getComputedStyle(primaryBody);
      const shellStyle = window.getComputedStyle(shell);
      const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
      const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
      const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
      const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
      const rowGap = parseFloat(computedStyle.rowGap || computedStyle.gap) || 0;
      const evalGap = parseFloat(shellStyle.getPropertyValue('--layout-eval-gap')) || 0;
      const fixedBlockHeights = [
        measureVisibleHeight(mobileControlsPanelRef.current)
      ];
      const visibleFixedBlockCount = fixedBlockHeights.filter((height) => height > 0.5).length;
      const evalHeight = measureVisibleHeight(mobileEvalWrapRef.current);
      const availableInlineSize =
        primaryBody.getBoundingClientRect().width -
        paddingLeft -
        paddingRight;
      const availableBoardSize =
        primaryBody.getBoundingClientRect().height -
        paddingTop -
        paddingBottom -
        fixedBlockHeights.reduce((sum, height) => sum + height, 0) -
        (rowGap * visibleFixedBlockCount) -
        evalHeight -
        (evalHeight > 0.5 ? evalGap : 0);
      const normalizedInlineSize = Math.max(0, Math.floor(availableInlineSize));
      const normalizedBoardSize = Math.max(0, Math.floor(availableBoardSize));
      if (normalizedInlineSize <= 0 || normalizedBoardSize <= 0) {
        shell.style.removeProperty('--mobile-primary-board-max-size');
        return;
      }

      const nextBoardSize = Math.min(normalizedInlineSize, normalizedBoardSize);
      shell.style.setProperty('--mobile-primary-board-max-size', `${nextBoardSize}px`);
    };

    const scheduleBoardResize = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }

      frameId = requestAnimationFrame(() => {
        frameId = null;
        updateBoardSize();
      });
    };

    scheduleBoardResize();

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleBoardResize) : null;
    for (const element of [
      primaryBody,
      mobileHeaderRef.current,
      mobileControlsPanelRef.current,
      mobileEvalWrapRef.current
    ]) {
      if (element) {
        resizeObserver?.observe(element);
      }
    }

    window.addEventListener('resize', scheduleBoardResize);
    window.visualViewport?.addEventListener('resize', scheduleBoardResize);

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }

      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleBoardResize);
      window.visualViewport?.removeEventListener('resize', scheduleBoardResize);
      shell.style.removeProperty('--mobile-primary-board-max-size');
    };
  }, [isMobileStandardLayout, prefs.showEngineEval]);

  useEffect(() => {
    const shell = appShellRef.current;
    const secondaryScreen = mobileSecondaryScreenRef.current;

    if (!shell || !secondaryScreen || !isMobileStandardLayout) {
      mobileSnapTouchStartYRef.current = null;
      mobileSnapTouchStartScrollTopRef.current = null;
      mobileSnapLockedRef.current = false;
      if (mobileSnapUnlockTimeoutRef.current !== null) {
        window.clearTimeout(mobileSnapUnlockTimeoutRef.current);
        mobileSnapUnlockTimeoutRef.current = null;
      }
      return;
    }

    const snapThresholdPx = 24;
    const snapTopTolerancePx = 48;

    const clearSnapUnlockTimeout = () => {
      if (mobileSnapUnlockTimeoutRef.current === null) {
        return;
      }

      window.clearTimeout(mobileSnapUnlockTimeoutRef.current);
      mobileSnapUnlockTimeoutRef.current = null;
    };

    const releaseSnapLockSoon = () => {
      clearSnapUnlockTimeout();
      mobileSnapUnlockTimeoutRef.current = window.setTimeout(() => {
        mobileSnapLockedRef.current = false;
        mobileSnapUnlockTimeoutRef.current = null;
      }, 380);
    };

    const snapToTop = (top: number) => {
      if (mobileSnapLockedRef.current) {
        return;
      }

      mobileSnapLockedRef.current = true;
      shell.scrollTo({
        top,
        behavior: 'smooth'
      });
      releaseSnapLockSoon();
    };

    const getSecondaryTop = () => secondaryScreen.offsetTop;

    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 10 || headerSettingsRef.current?.open || headerLanguageRef.current?.open) {
        return;
      }

      const secondaryTop = getSecondaryTop();

      if (event.deltaY > 0 && shell.scrollTop < secondaryTop - snapTopTolerancePx) {
        event.preventDefault();
        snapToTop(secondaryTop);
        return;
      }

      if (
        event.deltaY < 0 &&
        shell.scrollTop >= secondaryTop - snapTopTolerancePx &&
        shell.scrollTop <= secondaryTop + snapTopTolerancePx
      ) {
        event.preventDefault();
        snapToTop(0);
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || headerSettingsRef.current?.open || headerLanguageRef.current?.open) {
        mobileSnapTouchStartYRef.current = null;
        mobileSnapTouchStartScrollTopRef.current = null;
        return;
      }

      mobileSnapTouchStartYRef.current = event.touches[0]?.clientY ?? null;
      mobileSnapTouchStartScrollTopRef.current = shell.scrollTop;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const startY = mobileSnapTouchStartYRef.current;
      const startScrollTop = mobileSnapTouchStartScrollTopRef.current;

      if (startY === null || startScrollTop === null || event.touches.length !== 1 || mobileSnapLockedRef.current) {
        return;
      }

      const currentY = event.touches[0]?.clientY;
      if (typeof currentY !== 'number') {
        return;
      }

      const deltaY = startY - currentY;
      const secondaryTop = getSecondaryTop();

      if (deltaY > snapThresholdPx && startScrollTop < secondaryTop - snapTopTolerancePx && shell.scrollTop < secondaryTop) {
        event.preventDefault();
        mobileSnapTouchStartYRef.current = null;
        mobileSnapTouchStartScrollTopRef.current = null;
        snapToTop(secondaryTop);
        return;
      }

      if (
        deltaY < -snapThresholdPx &&
        startScrollTop >= secondaryTop - snapTopTolerancePx &&
        startScrollTop <= secondaryTop + snapTopTolerancePx &&
        shell.scrollTop <= secondaryTop + snapTopTolerancePx
      ) {
        event.preventDefault();
        mobileSnapTouchStartYRef.current = null;
        mobileSnapTouchStartScrollTopRef.current = null;
        snapToTop(0);
      }
    };

    const handleTouchEnd = () => {
      mobileSnapTouchStartYRef.current = null;
      mobileSnapTouchStartScrollTopRef.current = null;
    };

    shell.addEventListener('wheel', handleWheel, { passive: false });
    shell.addEventListener('touchstart', handleTouchStart, { passive: true });
    shell.addEventListener('touchmove', handleTouchMove, { passive: false });
    shell.addEventListener('touchend', handleTouchEnd);
    shell.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      shell.removeEventListener('wheel', handleWheel);
      shell.removeEventListener('touchstart', handleTouchStart);
      shell.removeEventListener('touchmove', handleTouchMove);
      shell.removeEventListener('touchend', handleTouchEnd);
      shell.removeEventListener('touchcancel', handleTouchEnd);
      mobileSnapTouchStartYRef.current = null;
      mobileSnapTouchStartScrollTopRef.current = null;
      mobileSnapLockedRef.current = false;
      clearSnapUnlockTimeout();
    };
  }, [isMobileStandardLayout]);

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
      setLastMoveSquares(null);
      resetHints();
      setPreparedHintForNode(response.state.nodeId, response.ui.hintPreview);
      setLastBestMove(null);
      setCorrectMessage(null);
      setReviewCursor(null);
      setSessionTree(null);
      setWrongMoveSquare(null);
      setLineCompleteSquare(null);
      setOneTryFailed(false);
      resetPremoves();
      setStatusMessage(status);
    },
    [resetHints, resetPremoves, setPreparedHintForNode]
  );

  const removeCaptureRainPiece = useCallback((id: number) => {
    setFallingCapturePieces((previous) => previous.filter((entry) => entry.id !== id));
  }, []);

  const spawnCaptureRainPiece = useCallback(
    (fen: string, uciMove: string) => {
      if (!prefs.captureRain) {
        return;
      }

      const skin = getCapturedPieceSkin(fen, uciMove);
      if (!skin) {
        return;
      }

      const id = capturePieceIdRef.current++;
      const fallDurationMs = Math.round(randomBetween(6500, 12000));
      const piece = {
        id,
        ...skin,
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

  useEffect(() => {
    let cancelled = false;
    let retryTimer = 0;

    const loadInitial = async () => {
      setLoading(true);
      setErrorMessage(null);
      setHistoryErrorMessage(null);
      setTreeErrorMessage(null);
      resetHints();
      setPreparedHint(null);
      setLastBestMove(null);
      setLastMoveSquares(null);
      setReviewCursor(null);

      try {
        const response = await getInitialSession(
          initialPrefsRef.current.variationMode,
          initialPrefsRef.current.autoNext
        );

        if (!cancelled) {
          initialLoadRetryAttemptRef.current = 0;
          applyStartedSession(response, literalUiMessage('\u00A0'));
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        setErrorMessage(
          error instanceof Error
            ? literalUiMessage(error.message)
            : translatedUiMessage((copy) => copy.failedToLoadPuzzle)
        );
        setStatusMessage(translatedUiMessage((copy) => copy.failedToLoadPuzzle));

        const retryIndex = Math.min(
          initialLoadRetryAttemptRef.current,
          INITIAL_LOAD_RETRY_DELAYS_MS.length - 1
        );
        const retryDelayMs = INITIAL_LOAD_RETRY_DELAYS_MS[retryIndex];
        initialLoadRetryAttemptRef.current += 1;
        retryTimer = window.setTimeout(() => {
          if (!cancelled) {
            void loadInitial();
          }
        }, retryDelayMs);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadInitial();

    return () => {
      cancelled = true;
      if (retryTimer !== 0) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [applyStartedSession, resetHints]);

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
      setPreparedHint(null);
      setErrorMessage(null);

      try {
        const response = await playMove(sessionId, uciMove, prefs.skipSimilarVariations);
        setState(response.nextState);
        setPreparedHintForNode(response.nextState.nodeId, response.ui.hintPreview);
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
                    ui: next.ui
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
                  ui: next.ui
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
    if (!sessionId || loading || historyLoading || isReviewMode || oneTryLocked || !state) {
      return;
    }

    setErrorMessage(null);
    const activePreparedHint = preparedHint?.nodeId === state.nodeId ? preparedHint : null;

    const applyHintDisplay = (pieceFromSquare: string | null, bestMoveUci: string | null) => {
      const nextHintLevel = pieceFromSquare ? Math.min(hintLevel + 1, 2) : 0;
      setHintLevel(nextHintLevel);
      setHintSquare(pieceFromSquare);
      setHintArrow(nextHintLevel >= 2 && bestMoveUci ? getMoveSquares(bestMoveUci) : null);
      resetPremoves();
      setDisplayFen(state.fen);
      setLastMoveSquares(null);
      setWrongMoveSquare(null);
      setLineCompleteSquare(null);
      setStatusMessage(
        translatedUiMessage((copy) =>
          pieceFromSquare
            ? nextHintLevel >= 2
              ? copy.hintShownPieceAndArrow
              : copy.hintShownPiece
            : copy.noHintAvailable
        )
      );
    };

    if (activePreparedHint) {
      applyHintDisplay(activePreparedHint.pieceFromSquare, activePreparedHint.bestMoveUci);

      const requestId = ++hintSyncRequestRef.current;
      void getHint(sessionId)
        .then((response) => {
          if (hintSyncRequestRef.current !== requestId) {
            return;
          }

          setState(response.state);
          setPreparedHintForNode(response.state.nodeId, response);
          resetPremoves();
          setDisplayFen(response.state.fen);
          setLastMoveSquares(null);
          setWrongMoveSquare(null);
          setLineCompleteSquare(null);
          void loadSessionArtifacts(sessionId);
        })
        .catch((error) => {
          if (hintSyncRequestRef.current !== requestId) {
            return;
          }

          setErrorMessage(
            error instanceof Error
              ? literalUiMessage(error.message)
              : translatedUiMessage((copy) => copy.hintFailed)
          );
        });
      return;
    }

    setLoading(true);
    try {
      const response = await getHint(sessionId);
      applyHintDisplay(response.pieceFromSquare, response.bestMoveUci);
      setState(response.state);
      setPreparedHintForNode(response.state.nodeId, response);
      resetPremoves();
      setDisplayFen(response.state.fen);
      setLastMoveSquares(null);
      setWrongMoveSquare(null);
      setLineCompleteSquare(null);

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
    preparedHint,
    resetPremoves,
    sessionId,
    setPreparedHintForNode,
    state,
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
      setPreparedHint(null);
      try {
        const response = await revealSolution(sessionId, mode, prefs.skipSimilarVariations);
        setState(response.nextState);
        setPreparedHintForNode(response.nextState.nodeId, response.ui.hintPreview);
        setLastBestMove(response.bestMoveUci);
        setWrongMoveSquare(null);
        setLineCompleteSquare(null);
        let artifactSessionId = sessionId;

        if (!response.bestMoveUci || !response.afterFen) {
          resetPremoves();
          setDisplayFen(response.nextState.fen);
          setLastMoveSquares(null);
          setStatusMessage(
            translatedUiMessage((copy) =>
              isPuzzleSolved(response.nextState) ? copy.puzzleComplete : copy.noMoveToReveal
            )
          );
          if (mode === 'auto' && prefs.autoNext && isPuzzleSolved(response.nextState)) {
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
                  ui: next.ui
                },
                translatedUiMessage((copy) => copy.newPuzzleLoaded)
              );
              artifactSessionId = next.newSessionId;
            }
          }
          void loadSessionArtifacts(artifactSessionId);
          return;
        }

        const moveSquares = getMoveSquares(response.bestMoveUci);
        if (moveSquares) {
          setLastMoveSquares(moveSquares);
        }

        const moveSoundDecision = getMoveSoundDecision(baseFen, response.bestMoveUci);
        spawnCaptureRainPiece(baseFen, response.bestMoveUci);
        playMoveSoundDecision(moveSoundDecision, prefs.soundEnabled);
        const revealedMove = response.bestMoveSan ?? formatUciMoveAsSan(baseFen, response.bestMoveUci) ?? response.bestMoveUci;

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
          if (mode === 'auto' && prefs.autoNext) {
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
                  ui: next.ui
                },
                translatedUiMessage((copy) => copy.newPuzzleLoaded)
              );
              artifactSessionId = next.newSessionId;
            }
          }
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

        void loadSessionArtifacts(artifactSessionId);
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
      prefs.autoNext,
      prefs.animations,
      prefs.variationMode,
      prefs.skipSimilarVariations,
      prefs.soundEnabled,
      resetHints,
      resetPremoves,
      sessionId,
      spawnCaptureRainPiece,
      state,
      activatePrefetchedSession,
      applyStartedSession,
      takePrefetchedNextSession,
      i18n,
      oneTryLocked
    ]
  );

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
            ui: next.ui
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
    if (!sessionId || loading || historyLoading || isReviewMode) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await restartSession(sessionId, prefs.variationMode, prefs.autoNext);
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
    sessionId,
    i18n
  ]);

  useEffect(() => {
    if (!sessionId || !state) {
      autoPlaySolveStateRef.current = { sessionId: null, solved: false };
      return;
    }

    const solved = isPuzzleSolved(state);
    if (loading || historyLoading || isReviewMode || oneTryLocked) {
      return;
    }

    const previous = autoPlaySolveStateRef.current;
    const justSolved = previous.sessionId === sessionId && solved && !previous.solved;
    autoPlaySolveStateRef.current = { sessionId, solved };

    if (!prefs.autoPlay) {
      return;
    }

    if (solved) {
      if (prefs.autoNext && justSolved) {
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

  useEffect(() => {
    const autoNextJustEnabled = !previousAutoNextRef.current && prefs.autoNext;
    previousAutoNextRef.current = prefs.autoNext;

    if (!autoNextJustEnabled) {
      return;
    }

    if (!sessionId || !state || loading || historyLoading || isReviewMode || oneTryLocked) {
      return;
    }

    if (!isPuzzleSolved(state)) {
      return;
    }

    void handleNextPuzzle();
  }, [
    handleNextPuzzle,
    historyLoading,
    isReviewMode,
    loading,
    oneTryLocked,
    prefs.autoNext,
    sessionId,
    state
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
    setPreparedHint(null);
    setLastBestMove(null);
    setLastMoveSquares(null);
    setCorrectMessage(null);
    setReviewCursor(null);

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
      setPreparedHint(null);
      setLastBestMove(null);
      setLastMoveSquares(null);
      setCorrectMessage(null);
      setReviewCursor(null);

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

  const handlePreviousPuzzle = useCallback(() => {
    if (!previousPuzzleSessionId) {
      return;
    }

    void handleLoadHistorySession(previousPuzzleSessionId);
  }, [handleLoadHistorySession, previousPuzzleSessionId]);

  const handleTransportNextPuzzle = useCallback(() => {
    if (nextHistoryPuzzleSessionId) {
      void handleLoadHistorySession(nextHistoryPuzzleSessionId);
      return;
    }

    void handleNextPuzzle();
  }, [handleLoadHistorySession, handleNextPuzzle, nextHistoryPuzzleSessionId]);

  const handleReviewMove = useCallback(
    (node: SessionTreeNode) => {
      if (!state || !currentReviewNodeId) {
        return;
      }

      if (node.parent_id !== currentReviewNodeId) {
        return;
      }

      const basePath = reviewCursor ? reviewCursor.path.slice(0, reviewCursor.index + 1) : livePath;
      setReviewCursor({
        path: [...basePath, node.id],
        index: basePath.length
      });
    },
    [currentReviewNodeId, livePath, reviewCursor, state]
  );

  const handleReviewBackOne = useCallback(() => {
    if (livePath.length <= 1 && !reviewCursor) {
      return;
    }

    setReviewCursor((previous) => {
      if (!previous) {
        if (livePath.length <= 1) {
          return null;
        }

        return {
          path: livePath,
          index: livePath.length - 2
        };
      }

      if (previous.index <= 0) {
        return null;
      }

      return {
        ...previous,
        index: previous.index - 1
      };
    });
  }, [livePath, reviewCursor]);

  const handleReviewForwardOne = useCallback(() => {
    if (!reviewCursor) {
      return;
    }

    const nextIndex = reviewCursor.index + 1;
    if (nextIndex >= reviewCursor.path.length) {
      return;
    }

    const nextPath = reviewCursor.path.slice(0, nextIndex + 1);
    if (pathsMatch(nextPath, livePath)) {
      setReviewCursor(null);
      return;
    }

    setReviewCursor({
      ...reviewCursor,
      index: nextIndex
    });
  }, [livePath, reviewCursor]);

  const toggleVariationMode = (checked: boolean) => {
    setPrefs((previous) => ({
      ...previous,
      variationMode: checked ? 'explore' : 'mainline'
    }));
  };

  if (!state || !puzzle) {
    return <LoadingScreen i18n={i18n} errorText={errorText} pieceSrc={withBasePath('pieces/cburnett/wR.svg')} />;
  }

  const completedBranchesText = i18n.completedBranches(state.completedBranches, state.totalLines);
  const normalizedPuzzleTitle = normalizeTitleText(puzzle.title);
  const isUntitledPuzzle = isUntitledPuzzleTitle(normalizedPuzzleTitle, i18n.untitledPuzzle);
  const interactive = boardCanInteract;
  const shellClassName = ['app-shell', isZenMode ? 'is-zen-mode' : null, prefs.showEngineEval ? 'has-eval' : 'no-eval']
    .filter(Boolean)
    .join(' ');
  const footerLinks: AppChromeLink[] = [
    { href: REPO_URL, label: i18n.github, external: true }
  ];
  const zenExitHintLabel = isMobileViewport ? (i18n.exitZenModeHintMobile ?? 'Tap here to exit zen mode') : i18n.exitZenModeHint;
  const boardColumnClassName = ['board-column', isMobileStandardLayout ? 'mobile-board-column' : null]
    .filter(Boolean)
    .join(' ');
  const boardStackClassName = [
    'board-stack',
    prefs.showEngineEval ? null : 'no-eval'
  ]
    .filter(Boolean)
    .join(' ');
  const statusPanelClassName = ['rail-block', 'header', 'rail-status', isMobileStandardLayout ? 'mobile-status-panel' : null]
    .filter(Boolean)
    .join(' ');
  const desktopStatusSectionClassName = ['desktop-side-panel-section', 'header', 'rail-status']
    .filter(Boolean)
    .join(' ');
  const controlsPanelClassName = ['rail-block', 'rail-actions', isMobileStandardLayout ? 'mobile-controls-panel' : null]
    .filter(Boolean)
    .join(' ');
  const historyStripClassName = ['history-strip', prefs.autoPlay ? 'is-muted' : null, isMobileViewport ? 'is-mobile' : null]
    .filter(Boolean)
    .join(' ');
  const pathMovesLabel = i18n.pathMoves('').trimEnd();
  const puzzleActionButtons = (
    <PuzzleActionButtons
      disabled={panelControlsDisabled}
      isReviewMode={isReviewMode}
      hintsEnabled={prefs.hintsEnabled}
      canHint={canRequestContinuation}
      canReveal={canRequestContinuation}
      i18n={i18n}
      onHint={() => void handleHint()}
      onReveal={() => void handleReveal()}
      onRestartPuzzle={() => void handleRestartPuzzle()}
    />
  );
  const zenReviewNavigationButtons = (
    <>
      <button
        type="button"
        className="btn-secondary transport-control-button"
        disabled={panelControlsDisabled || !previousPuzzleSessionId}
        onClick={handlePreviousPuzzle}
        aria-label="Previous puzzle"
        title="Previous puzzle"
      >
        <TransportControlIcon variant="skip-back" />
      </button>
      <button
        type="button"
        className="btn-secondary transport-control-button"
        disabled={panelControlsDisabled || !canReviewBackward}
        onClick={handleReviewBackOne}
        aria-label={i18n.backOneMove}
        title={i18n.backOneMove}
      >
        <TransportControlIcon variant="back" />
      </button>
      <button
        type="button"
        className="btn-secondary transport-control-button"
        disabled={panelControlsDisabled || !canReviewForward}
        onClick={handleReviewForwardOne}
        aria-label="Forward one move"
        title="Forward one move"
      >
        <TransportControlIcon variant="forward" />
      </button>
      <button
        type="button"
        className="btn-secondary transport-control-button"
        disabled={panelControlsDisabled || (!nextHistoryPuzzleSessionId && !sessionId)}
        onClick={handleTransportNextPuzzle}
        aria-label="Next puzzle"
        title="Next puzzle"
      >
        <TransportControlIcon variant="skip-forward" />
      </button>
    </>
  );
  const promotionPieceLabels = getPromotionPieceLabels(i18n);
  const statusPanelContent = (
    <>
      <div className="rail-status-meta">
        {!isMobileStandardLayout && !isUntitledPuzzle ? <p className="subtitle rail-title">{normalizedPuzzleTitle}</p> : null}
        {!isMobileStandardLayout ? <p className="meta rail-id">{i18n.puzzleId(puzzle.publicId)}</p> : null}
      </div>
      <div className="rail-status-main">
        <p className="turn-kicker">{turnKickerText}</p>
        <p className="turn-indicator">{objectiveText}</p>
        {prefs.showEngineEval ? (
          <p className="meta rail-engine">
            <span>{engineEvalText}</span>
            <span className="rail-engine-separator" aria-hidden="true">
              •
            </span>
            <span>{engineDepthText}</span>
            <span className="rail-engine-separator" aria-hidden="true">
              •
            </span>
            <span>{engineEvalSideText}</span>
          </p>
        ) : null}
        <p className={`status status-line ${hasDisplayStatusText ? '' : 'is-empty'}`}>{displayStatusText}</p>
        <p className={`correct correct-line ${hasCorrectText ? '' : 'is-empty'}`}>{correctText ?? '\u00A0'}</p>
        <p className="meta rail-branch">{completedBranchesText}</p>
      </div>
    </>
  );
  const statusPanel = (
    <section className={statusPanelClassName}>
      {statusPanelContent}
    </section>
  );
  const controlsPanelContent = (
    <>
      <div className="button-row next-live-row">
        <button
          type="button"
          className="btn-secondary"
          disabled={panelControlsDisabled || isReviewMode || !prefs.hintsEnabled || !canRequestContinuation}
          onClick={() => void handleHint()}
        >
          {i18n.hint}
        </button>
      </div>
      <div className="button-row">
        <button
          type="button"
          className="btn-secondary"
          disabled={panelControlsDisabled || isReviewMode || !canRequestContinuation}
          onClick={() => void handleReveal()}
        >
          {i18n.showSolution}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={panelControlsDisabled || isReviewMode}
          onClick={() => void handleRestartPuzzle()}
        >
          {i18n.restartPuzzle}
        </button>
      </div>
      <div className="button-row arrow-strip-row">
        <button
          type="button"
          className="btn-secondary transport-control-button"
          disabled={panelControlsDisabled || !previousPuzzleSessionId}
          onClick={handlePreviousPuzzle}
          aria-label="Previous puzzle"
          title="Previous puzzle"
        >
          <TransportControlIcon variant="skip-back" />
        </button>
        <button
          type="button"
          className="btn-secondary transport-control-button"
          disabled={panelControlsDisabled || !canReviewBackward}
          onClick={handleReviewBackOne}
          aria-label={i18n.backOneMove}
          title={i18n.backOneMove}
        >
          <TransportControlIcon variant="back" />
        </button>
        <button
          type="button"
          className="btn-secondary transport-control-button"
          disabled={panelControlsDisabled || !canReviewForward}
          onClick={handleReviewForwardOne}
          aria-label="Forward one move"
          title="Forward one move"
        >
          <TransportControlIcon variant="forward" />
        </button>
        <button
          type="button"
          className="btn-secondary transport-control-button"
          disabled={panelControlsDisabled || (!nextHistoryPuzzleSessionId && !sessionId)}
          onClick={handleTransportNextPuzzle}
          aria-label="Next puzzle"
          title="Next puzzle"
        >
          <TransportControlIcon variant="skip-forward" />
        </button>
      </div>
    </>
  );
  const controlsPanel = (
    <section ref={mobileControlsPanelRef} className={controlsPanelClassName}>
      {controlsPanelContent}
    </section>
  );
  const historyPanelContent = (
    <>
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
    </>
  );
  const pgnPanelContent = (
    <>
      <div className="pgn-header-row">
        <p className="pgn-title">{i18n.pgnExplorer}</p>
      </div>

      {pgnLineNodes.length > 0 ? (
        <p className="meta pgn-path">
          <span className="pgn-path-label">{pathMovesLabel}</span>
          <span className="pgn-path-moves">
            {pgnLineNodes.map((node) => (
              <MoveText
                key={node.id}
                moveText={formatNodeMoveText(node)}
                ply={node.ply}
                renderPieceImages={prefs.renderPgnPieceSvgs}
                className="pgn-path-move"
              />
            ))}
          </span>
        </p>
      ) : (
        <p className="meta pgn-path">{i18n.pathLivePosition}</p>
      )}

      {treeError ? <p className="error">{treeError}</p> : null}

      <div className="pgn-sequence" aria-label="PGN line">
        {pgnLineNodes.length === 0 ? (
          <span className="pgn-sequence-empty">{i18n.pathLivePosition}</span>
        ) : (
          pgnLineNodes.map((node, index) => {
            const isCurrentMove = activeReviewPath[index + 1] === currentReviewNodeId;
            return (
              <button
                key={node.id}
                type="button"
                className={`pgn-sequence-move ${isCurrentMove ? 'is-current' : ''}`}
                disabled={panelControlsDisabled}
                aria-label={formatPgnMoveLabel(node)}
                onClick={() => {
                  const targetIndex = index + 1;
                  if (pathsMatch(pgnDisplayPath, livePath) && targetIndex === livePath.length - 1) {
                    setReviewCursor(null);
                    return;
                  }

                  setReviewCursor({
                    path: pgnDisplayPath,
                    index: targetIndex
                  });
                }}
              >
                <span className="pgn-sequence-prefix">{getPgnMovePrefix(node)}</span>{' '}
                <MoveText moveText={formatNodeMoveText(node)} ply={node.ply} renderPieceImages={prefs.renderPgnPieceSvgs} />
              </button>
            );
          })
        )}
      </div>

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
              aria-label={formatNodeMoveText(node)}
              onClick={() => handleReviewMove(node)}
            >
              <MoveText moveText={formatNodeMoveText(node)} ply={node.ply} renderPieceImages={prefs.renderPgnPieceSvgs} />
              <span>{node.is_mainline ? i18n.mainLine : i18n.variationLine}</span>
            </button>
          ))
        )}
      </div>
    </>
  );
  const mobileSecondaryPanel = (
    <section className="rail-block mobile-secondary-panel">
      <div className="mobile-secondary-meta">
        {!isUntitledPuzzle ? <p className="subtitle rail-title mobile-secondary-title">{normalizedPuzzleTitle}</p> : null}
        <p className="meta rail-id mobile-secondary-id">{i18n.puzzleId(puzzle.publicId)}</p>
      </div>
      <div className="pgn-panel" id="explorer">
        {pgnPanelContent}
      </div>
    </section>
  );
  const mobileHistoryPanel = (
    <section className="rail-block mobile-secondary-panel mobile-history-panel">
      <div className={historyStripClassName} id="history" aria-label={i18n.recentGameHistory}>
        {historyPanelContent}
      </div>
    </section>
  );
  const footerContent = (
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
  );
  const headerContent = (
    <AppHeader
      i18n={i18n}
      puzzleCountText={
        puzzleCount === null ? i18n.livePuzzleCountUnavailable : i18n.puzzleCount(countFormatter.format(puzzleCount))
      }
      headerRef={mobileHeaderRef}
      headerLanguageRef={headerLanguageRef}
      headerSettingsRef={headerSettingsRef}
      closeHeaderMenus={closeHeaderMenus}
      prefs={prefs}
      setPrefs={setPrefs}
      toggleVariationMode={toggleVariationMode}
      puzzleIdInput={puzzleIdInput}
      setPuzzleIdInput={setPuzzleIdInput}
      handleLoadById={handleLoadById}
      loading={loading}
      historyLoading={historyLoading}
    />
  );
  const boardPanel = (
    <section className={boardColumnClassName} id="board">
      <div className={boardStackClassName}>
        <div className="board-stage">
          {prefs.showEngineEval ? (
            <div ref={mobileEvalWrapRef}>
              <EvalBar cp={displayedEngineCp} mate={displayedEngineMate} />
            </div>
          ) : null}
          <div className="board-shell">
            <ChessBoard
              fen={boardFen ?? state.fen}
              orientation={playerOrientation}
              checkColor={checkColor}
              interactive={interactive}
              canMoveExecution={!loading && !historyLoading}
              animationsEnabled={prefs.animations}
              animationDurationMs={boardAnimationDurationMs}
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
            <div className="button-row zen-action-row">
              {puzzleActionButtons}
            </div>
            <div className="button-row zen-navigation-row">
              {zenReviewNavigationButtons}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
  const mobilePrimaryStack = (
    <div className="mobile-primary-stack">
      {boardPanel}
      {controlsPanel}
    </div>
  );
  const desktopSidePanel = (
    <section className="rail-block desktop-side-panel">
      <div className={desktopStatusSectionClassName}>
        {statusPanelContent}
      </div>
      <div className="desktop-side-panel-section rail-actions">
        {controlsPanelContent}
      </div>
      <div className={`desktop-side-panel-section ${historyStripClassName}`} id="history" aria-label={i18n.recentGameHistory}>
        {historyPanelContent}
      </div>
      <div className="desktop-side-panel-section pgn-panel" id="explorer">
        {pgnPanelContent}
      </div>
    </section>
  );

  return (
    <>
      <div ref={appShellRef} className={shellClassName}>
        <ZenExitHint
          visible={isZenMode}
          label={zenExitHintLabel}
          onExit={() =>
            setPrefs((previous) => ({
              ...previous,
              zenMode: false
            }))
          }
        />
        <CaptureRainLayer
          pieces={fallingCapturePieces}
          onPieceAnimationEnd={handleCaptureRainPieceAnimationEnd}
        />
        {isMobileStandardLayout ? (
          <>
            <section className="mobile-snap-screen mobile-primary-screen">
              {headerContent}
              <main ref={mobilePrimaryPageBodyRef} className="mobile-snap-page-body mobile-primary-page-body">
                {mobilePrimaryStack}
              </main>
            </section>
            <section ref={mobileSecondaryScreenRef} className="mobile-snap-screen mobile-secondary-screen">
              <div className="mobile-snap-page-body mobile-secondary-page-body">
                <div className="mobile-secondary-stack">
                  {statusPanel}
                  {mobileSecondaryPanel}
                </div>
              </div>
            </section>
            <section className="mobile-snap-screen mobile-tertiary-screen">
              <div className="mobile-snap-page-body mobile-secondary-page-body mobile-tertiary-page-body">
                <div className="mobile-tertiary-stack">
                  {mobileHistoryPanel}
                </div>
                <footer className="app-footer mobile-inline-footer">
                  {footerContent}
                </footer>
              </div>
            </section>
          </>
        ) : (
          <>
            {headerContent}
            <main className="layout split-layout">
              <>
                {boardPanel}
                {!isZenMode ? (
                <aside className="side-column">
                  {desktopSidePanel}
                </aside>
              ) : null}
              </>
            </main>
          </>
        )}
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
        {!isMobileStandardLayout ? <footer className="app-footer">{footerContent}</footer> : null}
      </div>
      {errorText ? (
        <p className="global-error-toast" role="alert" aria-live="assertive">
          {errorText}
        </p>
      ) : null}
    </>
  );
}
