import { useCallback, useEffect, useState } from 'react';
import { Chess, type PieceSymbol, type Square } from 'chess.js';
import { ChessBoard } from './components/ChessBoard.js';
import { EvalBar } from './components/EvalBar.js';
import { useLocalPrefs } from './hooks/useLocalPrefs.js';
import { useStockfishEval } from './hooks/useStockfishEval.js';
import { getHint, nextPuzzle, playMove, revealSolution, skipVariation, startSession } from './lib/api.js';
import { playMoveSound, type MoveSoundType } from './lib/moveSounds.js';
import type { MoveResponse, SessionStatePayload } from './types/api.js';

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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

function getMoveSoundType(fen: string, uciMove: string): MoveSoundType | null {
  if (uciMove.length < 4) {
    return null;
  }

  const chess = new Chess(fen);
  const from = uciMove.slice(0, 2) as Square;
  const to = uciMove.slice(2, 4) as Square;
  const promotion = (uciMove[4] as PieceSymbol | undefined) ?? undefined;
  const move = chess.move({ from, to, promotion });

  if (!move) {
    return null;
  }

  if (move.isKingsideCastle() || move.isQueensideCastle()) {
    return 'castle';
  }

  if (move.isCapture()) {
    return 'capture';
  }

  return 'move';
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

export function App() {
  const { prefs, setPrefs } = useLocalPrefs();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [puzzle, setPuzzle] = useState<PuzzleHeader | null>(null);
  const [state, setState] = useState<SessionStatePayload | null>(null);
  const [displayFen, setDisplayFen] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('Loading puzzle...');
  const [correctText, setCorrectText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hintSquare, setHintSquare] = useState<string | null>(null);
  const [lastBestMove, setLastBestMove] = useState<string | null>(null);
  const [playerOrientation, setPlayerOrientation] = useState<'white' | 'black'>('white');
  const [lastMoveSquares, setLastMoveSquares] = useState<[Square, Square] | null>(null);
  const [puzzleIdInput, setPuzzleIdInput] = useState('');

  const engineEval = useStockfishEval(displayFen ?? state?.fen ?? null);

  const animateAutoPlay = useCallback(
    async (response: MoveResponse, currentFen: string) => {
      const rewindFens = response.rewindFens ?? [];
      let rewindSourceFen = currentFen;
      if (rewindFens.length > 0) {
        setStatusText('Correct. Rewinding for next variation...');
        await wait(CORRECT_BREAK_MS);
        for (const fen of rewindFens) {
          setLastMoveSquares(getMoveSquaresBetweenFens(fen, rewindSourceFen));
          setDisplayFen(fen);
          rewindSourceFen = fen;
          await wait(REWIND_STEP_DELAY_MS);
        }
        await wait(REWIND_BREAK_MS);
      }

      if (!response.autoPlayStartFen || response.autoPlayedMoves.length === 0) {
        setDisplayFen(response.nextState.fen);
        return;
      }

      const currentOrRewoundFen = rewindSourceFen;
      if (currentOrRewoundFen !== response.autoPlayStartFen) {
        setDisplayFen(response.autoPlayStartFen);
        await wait(REWIND_STEP_DELAY_MS);
      }

      setStatusText('Correct. Opponent response...');
      const chess = new Chess(response.autoPlayStartFen);
      await wait(AUTO_PLAY_DELAY_MS);

      for (const move of response.autoPlayedMoves) {
        const soundType = getMoveSoundType(chess.fen(), move);
        const ok = applyUciMove(chess, move);
        if (!ok) {
          break;
        }
        const moveSquares = getMoveSquares(move);
        if (moveSquares) {
          setLastMoveSquares(moveSquares);
        }
        if (soundType) {
          playMoveSound(soundType);
        }
        setDisplayFen(chess.fen());
        await wait(AUTO_PLAY_DELAY_MS);
      }

      setDisplayFen(response.nextState.fen);
    },
    []
  );

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setErrorText(null);
    setHintSquare(null);
    setLastBestMove(null);
    setLastMoveSquares(null);

    try {
      const response = await startSession(prefs.variationMode, prefs.autoNext);
      setSessionId(response.sessionId);
      setPuzzle(response.puzzle);
      setPuzzleIdInput(response.puzzle.publicId);
      setState(response.state);
      setDisplayFen(response.state.fen);
      setPlayerOrientation(response.state.toMove === 'w' ? 'white' : 'black');
      setStatusText('Your move');
      setCorrectText(null);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to load puzzle');
      setStatusText('Failed to load puzzle');
    } finally {
      setLoading(false);
    }
  }, [prefs.autoNext, prefs.variationMode]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const handleMove = useCallback(
    async (uciMove: string) => {
      if (!sessionId || loading || !state) {
        return;
      }

      const baseFen = displayFen ?? state.fen;
      const moveSoundType = getMoveSoundType(baseFen, uciMove);
      const optimisticFen = getFenAfterUciMove(baseFen, uciMove);
      const optimisticLastMove = getMoveSquares(uciMove);
      if (optimisticFen) {
        setDisplayFen(optimisticFen);
        setLastMoveSquares(optimisticLastMove);
      }

      setLoading(true);
      setHintSquare(null);
      setErrorText(null);

      try {
        const response = await playMove(sessionId, uciMove);
        setState(response.nextState);
        setLastBestMove(response.bestMoveUci ?? null);
        setCorrectText(null);

        if (response.result === 'incorrect') {
          if (moveSoundType) {
            playMoveSound(moveSoundType);
          }
          setStatusText('Try again');
          setDisplayFen(response.nextState.fen);
          setLastMoveSquares(null);
        } else if (response.result === 'correct') {
          if (moveSoundType) {
            playMoveSound(moveSoundType);
          }
          setCorrectText('Correct');
          setStatusText('Correct move');
          await wait(CORRECT_BREAK_MS);
          await animateAutoPlay(response, optimisticFen ?? baseFen);
          setStatusText(
            `Correct. Branch ${response.nextState.completedBranches + 1}/${response.nextState.totalLines}`
          );
        } else {
          if (moveSoundType) {
            playMoveSound(moveSoundType);
          }
          setCorrectText('Correct');
          setStatusText('Correct move');
          await wait(CORRECT_BREAK_MS);
          await animateAutoPlay(response, optimisticFen ?? baseFen);
          setStatusText('Puzzle complete');
          if (prefs.autoNext) {
            await wait(SHORT_STATUS_DELAY_MS);
            const next = await nextPuzzle(sessionId, prefs.variationMode, prefs.autoNext);
            setSessionId(next.newSessionId);
            setPuzzle(next.puzzle);
            setPuzzleIdInput(next.puzzle.publicId);
            setState(next.state);
            setDisplayFen(next.state.fen);
            setPlayerOrientation(next.state.toMove === 'w' ? 'white' : 'black');
            setLastMoveSquares(null);
            setCorrectText(null);
            setStatusText('Next puzzle loaded');
          }
        }
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : 'Move failed');
      } finally {
        setLoading(false);
      }
    },
    [animateAutoPlay, displayFen, loading, prefs.autoNext, prefs.variationMode, sessionId, state]
  );

  const handleHint = useCallback(async () => {
    if (!sessionId || loading) {
      return;
    }

    setLoading(true);
    setErrorText(null);
    try {
      const response = await getHint(sessionId);
      setHintSquare(response.pieceFromSquare);
      setState(response.state);
      setDisplayFen(response.state.fen);
      setLastMoveSquares(null);
      setStatusText(response.pieceFromSquare ? 'Hint shown' : 'No hint available');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Hint failed');
    } finally {
      setLoading(false);
    }
  }, [loading, sessionId]);

  const handleReveal = useCallback(async () => {
    if (!sessionId || loading) {
      return;
    }

    setLoading(true);
    setErrorText(null);
    try {
      const response = await revealSolution(sessionId);
      setState(response.nextState);
      setDisplayFen(response.nextState.fen);
      setLastMoveSquares(null);
      setHintSquare(null);
      setLastBestMove(response.bestMoveUci);
      setStatusText(response.bestMoveUci ? `Best move: ${response.bestMoveUci}` : 'No move to reveal');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Reveal failed');
    } finally {
      setLoading(false);
    }
  }, [loading, sessionId]);

  const handleSkipVariation = useCallback(async () => {
    if (!sessionId || loading) {
      return;
    }

    setLoading(true);
    setErrorText(null);
    try {
      const response = await skipVariation(sessionId);
      setState(response.nextState);
      setDisplayFen(response.nextState.fen);
      setLastMoveSquares(null);
      setHintSquare(null);
      setStatusText(response.skipped ? 'Variation skipped' : 'Nothing to skip');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Skip variation failed');
    } finally {
      setLoading(false);
    }
  }, [loading, sessionId]);

  const handleNextPuzzle = useCallback(async () => {
    if (!sessionId || loading) {
      return;
    }

    setLoading(true);
    setErrorText(null);

    try {
      const next = await nextPuzzle(sessionId, prefs.variationMode, prefs.autoNext);
      setSessionId(next.newSessionId);
      setPuzzle(next.puzzle);
      setPuzzleIdInput(next.puzzle.publicId);
      setState(next.state);
      setDisplayFen(next.state.fen);
      setPlayerOrientation(next.state.toMove === 'w' ? 'white' : 'black');
      setLastMoveSquares(null);
      setHintSquare(null);
      setLastBestMove(null);
      setCorrectText(null);
      setStatusText('New puzzle loaded');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to load next puzzle');
    } finally {
      setLoading(false);
    }
  }, [loading, prefs.autoNext, prefs.variationMode, sessionId]);

  const handleLoadById = useCallback(async () => {
    if (loading) {
      return;
    }

    const trimmedId = puzzleIdInput.trim();
    if (!trimmedId) {
      setErrorText('Enter a puzzle ID');
      return;
    }

    setLoading(true);
    setErrorText(null);
    setHintSquare(null);
    setLastBestMove(null);
    setLastMoveSquares(null);
    setCorrectText(null);

    try {
      const response = await startSession(prefs.variationMode, prefs.autoNext, trimmedId);
      setSessionId(response.sessionId);
      setPuzzle(response.puzzle);
      setPuzzleIdInput(response.puzzle.publicId);
      setState(response.state);
      setDisplayFen(response.state.fen);
      setPlayerOrientation(response.state.toMove === 'w' ? 'white' : 'black');
      setStatusText('Puzzle loaded by ID');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to load puzzle by ID');
      setStatusText('Failed to load puzzle');
    } finally {
      setLoading(false);
    }
  }, [loading, prefs.autoNext, prefs.variationMode, puzzleIdInput]);

  const toggleVariationMode = (checked: boolean) => {
    setPrefs((previous) => ({
      ...previous,
      variationMode: checked ? 'explore' : 'mainline'
    }));
  };

  if (!state || !puzzle) {
    return (
      <main className="layout">
        <section className="panel">
          <h1>Chess Puzzle Trainer</h1>
          <p>{statusText}</p>
          {errorText ? <p className="error">{errorText}</p> : null}
        </section>
      </main>
    );
  }

  const interactive = !loading && statusText !== 'Puzzle complete';

  return (
    <main className="layout split-layout">
      <section className="board-column">
        <div className="board-stage">
          <EvalBar
            cp={engineEval.cp}
            mate={engineEval.mate}
            depth={engineEval.depth}
            error={engineEval.error}
            orientation={playerOrientation}
          />
          <div className="board-shell">
            <ChessBoard
              fen={displayFen ?? state.fen}
              orientation={playerOrientation}
              interactive={interactive && !loading}
              autoQueenPromotion={prefs.autoQueenPromotion}
              hintSquare={hintSquare}
              lastMove={lastMoveSquares}
              onMove={(uci) => void handleMove(uci)}
            />
          </div>
        </div>
      </section>

      <aside className="side-column">
        <section className="panel header">
          <h1>Chess Puzzle Trainer</h1>
          <p className="subtitle">{puzzle.title || 'Puzzle'}</p>
          <p className="meta">ID: {puzzle.publicId}</p>
          <p className="status status-line">{statusText}</p>
          <p className="correct correct-line">{correctText ?? '\u00A0'}</p>
          <p className="meta expected-line">{lastBestMove ? `Expected: ${lastBestMove}` : '\u00A0'}</p>
          {errorText ? <p className="error">{errorText}</p> : null}
        </section>

        <section className="panel controls">
          <label>
            <input
              type="checkbox"
              checked={prefs.variationMode === 'explore'}
              onChange={(event) => toggleVariationMode(event.target.checked)}
            />
            Explore variations
          </label>

          <label>
            <input
              type="checkbox"
              checked={prefs.autoNext}
              onChange={(event) =>
                setPrefs((previous) => ({
                  ...previous,
                  autoNext: event.target.checked
                }))
              }
            />
            Auto-next puzzle
          </label>

          <label>
            <input
              type="checkbox"
              checked={prefs.hintsEnabled}
              onChange={(event) =>
                setPrefs((previous) => ({
                  ...previous,
                  hintsEnabled: event.target.checked
                }))
              }
            />
            Enable hints
          </label>

          <div className="chip-row">
            <span className="meta">Promotion</span>
            <button
              type="button"
              className={`chip-toggle ${prefs.autoQueenPromotion ? 'chip-on' : 'chip-off'}`}
              onClick={() =>
                setPrefs((previous) => ({
                  ...previous,
                  autoQueenPromotion: !previous.autoQueenPromotion
                }))
              }
            >
              Auto-queen: {prefs.autoQueenPromotion ? 'On' : 'Off'}
            </button>
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
            <button type="button" disabled={loading || puzzleIdInput.trim().length === 0} onClick={() => void handleLoadById()}>
              Load ID
            </button>
          </div>

          <div className="button-row">
            <button type="button" disabled={loading || !prefs.hintsEnabled} onClick={() => void handleHint()}>
              Hint
            </button>
            <button type="button" disabled={loading} onClick={() => void handleReveal()}>
              Show solution
            </button>
            <button type="button" disabled={loading} onClick={() => void handleSkipVariation()}>
              Skip variation
            </button>
            <button type="button" disabled={loading} onClick={() => void handleNextPuzzle()}>
              Next puzzle
            </button>
          </div>

          <p className="meta">
            Branch {state.lineIndex + 1}/{state.totalLines} | Completed {state.completedBranches}/{state.totalLines}
          </p>
        </section>
      </aside>
    </main>
  );
}
