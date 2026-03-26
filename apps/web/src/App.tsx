import { type AnimationEvent as ReactAnimationEvent, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { ChessBoard } from './components/ChessBoard.js';
import { AppHeader } from './components/AppHeader.js';
import { CaptureRainLayer, getPromotionPieceLabels, LoadingScreen, PuzzleActionButtons, ReviewNavigationButtons, ZenExitHint } from './components/AppUiBits.js';
import { EvalBar } from './components/EvalBar.js';
import { MiniPreviewBoard } from './components/MiniPreviewBoard.js';
import { useLocalPrefs } from './hooks/useLocalPrefs.js';
import { useStockfishEval } from './hooks/useStockfishEval.js';
import { getHistoryDotSymbol, getHistoryDotTone } from './lib/historyDots.js';
import { getI18n } from './lib/i18n.js';
import { appendSimilarVariationStatus, applyUciMove, AUTO_PLAY_DELAY_MS, type AutoPlayAnimationPayload, type AppChromeLink, CAPTURE_RAIN_MAX_PIECES, CORRECT_BREAK_MS, type FallingCapturePiece, formatEngineEval, formatEngineSide, getCapturedPieceSkin, getFeedbackDelay, getFenAfterUciMove, getMoveSoundDecision, getMoveSquares, getMoveSquaresBetweenFens, getTerminalEvalDisplay, HISTORY_PREVIEW_DELAY_MS, type HistoryPreviewData, type HistoryPreviewState, isPuzzleSolved, literalUiMessage, MOBILE_HISTORY_PREVIEW_HOLD_MS, maybeWait, type PrefetchedNextState, type PuzzleHeader, randomBetween, REPO_URL, resolveUiMessage, REWIND_BREAK_MS, REWIND_STEP_DELAY_MS, SESSION_HISTORY_FETCH_LIMIT, SHORT_STATUS_DELAY_MS, translatedUiMessage, type UiMessage, wait, withBasePath, WRONG_MOVE_FEEDBACK_MS, playMoveSoundDecision } from './lib/appShared.js';
import { cacheLoadedSession, getPuzzleCount, getHint, loadSession, refreshSession, getSessionHistory, getSessionTree, nextPuzzle, prefetchNextPuzzle, playMove, retainLoadedSessions, revealSolution, skipVariation, startSession } from './lib/api.js';
import { primeMoveSounds } from './lib/moveSounds.js';
import type { SessionHistoryItem, SessionStatePayload, SessionTreeNode, SessionTreeResponse, StartSessionResponse } from './types/api.js';

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
    const menus = [headerSettingsRef.current, headerLanguageRef.current].filter(
      (menu): menu is HTMLDetailsElement => Boolean(menu)
    );

    if (menus.length === 0) {
      return;
    }

    const cleanups = menus.map((menu) => {
      const scrollTarget = menu.querySelector<HTMLDivElement>('.settings-content') ?? menu;

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
          return;
        }

        syncScrolledState();
      };

      scrollTarget.addEventListener('scroll', syncScrolledState, { passive: true });
      menu.addEventListener('toggle', handleToggle);
      syncScrolledState();

      return () => {
        scrollTarget.removeEventListener('scroll', syncScrolledState);
        menu.removeEventListener('toggle', handleToggle);
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

  const loadInitial = useCallback(async () => {
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
    return <LoadingScreen i18n={i18n} errorText={errorText} pieceSrc={withBasePath('pieces/cburnett/wR.svg')} />;
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
    <PuzzleActionButtons
      disabled={panelControlsDisabled}
      isReviewMode={isReviewMode}
      hintsEnabled={prefs.hintsEnabled}
      puzzleIsComplete={puzzleIsComplete}
      i18n={i18n}
      onHint={() => void handleHint()}
      onReveal={() => void handleReveal()}
      onRestartPuzzle={() => void handleRestartPuzzle()}
      onSkipVariation={() => void handleSkipVariation()}
      onNextPuzzle={() => void handleNextPuzzle()}
    />
  );
  const reviewNavigationButtons = (
    <ReviewNavigationButtons
      disabled={panelControlsDisabled}
      isReviewMode={isReviewMode}
      i18n={i18n}
      onBackOne={handleReviewBackOne}
      onBackToLive={handleBackToLive}
    />
  );
  const zenReviewNavigationButtons = (
    <ReviewNavigationButtons
      disabled={panelControlsDisabled}
      isReviewMode={isReviewMode}
      secondary
      i18n={i18n}
      onBackOne={handleReviewBackOne}
      onBackToLive={handleBackToLive}
    />
  );
  const promotionPieceLabels = getPromotionPieceLabels(i18n);

  return (
    <>
      <div className={shellClassName}>
        <ZenExitHint
          visible={isZenMode}
          label={i18n.exitZenModeHint}
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
        <AppHeader
          i18n={i18n}
          puzzleCountText={
            puzzleCount === null ? i18n.livePuzzleCountUnavailable : i18n.puzzleCount(countFormatter.format(puzzleCount))
          }
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
