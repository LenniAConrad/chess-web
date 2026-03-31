import {
  PuzzleSessionEngine,
  parsePuzzlePgn,
  type ParsedPuzzle,
  type SessionCursor,
  type VariationMode as CoreVariationMode
} from '@chess-web/chess-core';
import { withBasePath } from './appShared.js';
import type {
  HintPreview,
  HintResponse,
  MoveResponse,
  NextResponse,
  PuzzleCountResponse,
  RevealResponse,
  SessionHistoryClearResponse,
  SessionHistoryItem,
  SessionHistoryResponse,
  SessionStatePayload,
  SessionTreeResponse,
  SkipVariationResponse,
  StartSessionResponse,
  VariationMode
} from '../types/api.js';

interface OfflinePackIndex {
  version: number;
  count: number;
  totalBytes: number;
  offsets: number[];
}

interface OfflineSessionRecord {
  id: string;
  puzzleIndex: number;
  mode: VariationMode;
  cursor: SessionCursor;
  nodeId: number;
  createdAt: string;
  solved: boolean;
  revealed: boolean;
  autoplayUsed: boolean;
  wrongMoveCount: number;
  hintCount: number;
  prefetched: boolean;
}

interface OfflineStore {
  version: number;
  sessions: Record<string, OfflineSessionRecord>;
}

interface LoadedOfflinePuzzle {
  index: number;
  publicId: string;
  title: string;
  startFen: string;
  parsed: ParsedPuzzle;
}

const OFFLINE_STORE_KEY = 'rookbook-offline-store-v1';
const OFFLINE_INDEX_URL = withBasePath('offline/index.json');
const OFFLINE_PGN_URL = withBasePath('offline/puzzles.pgn');
const STORE_VERSION = 1;
let offlinePackIndexPromise: Promise<OfflinePackIndex> | null = null;
let offlinePackBlobPromise: Promise<Blob> | null = null;
let memoryStore: OfflineStore = createDefaultStore();
const puzzleCache = new Map<number, Promise<LoadedOfflinePuzzle>>();

function createDefaultStore(): OfflineStore {
  return {
    version: STORE_VERSION,
    sessions: {}
  };
}

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `offline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function puzzlePublicIdFromIndex(index: number): string {
  return `pz-${index + 1}`;
}

function puzzleTitleFromIndex(index: number): string {
  return `Puzzle ${index + 1}`;
}

function puzzleIndexFromPublicId(publicId: string): number | null {
  const match = /^pz-(\d+)$/.exec(publicId.trim());
  if (!match) {
    return null;
  }

  const rawIndex = Number(match[1]);
  if (!Number.isInteger(rawIndex) || rawIndex <= 0) {
    return null;
  }

  return rawIndex - 1;
}

function readStore(): OfflineStore {
  if (typeof localStorage === 'undefined') {
    return memoryStore;
  }

  try {
    const raw = localStorage.getItem(OFFLINE_STORE_KEY);
    if (!raw) {
      return createDefaultStore();
    }

    const parsed = JSON.parse(raw) as OfflineStore;
    if (parsed?.version !== STORE_VERSION || typeof parsed.sessions !== 'object' || !parsed.sessions) {
      return createDefaultStore();
    }

    return parsed;
  } catch {
    return createDefaultStore();
  }
}

function writeStore(store: OfflineStore): void {
  memoryStore = store;

  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(OFFLINE_STORE_KEY, JSON.stringify(store));
}

async function loadOfflinePackIndex(): Promise<OfflinePackIndex> {
  if (!offlinePackIndexPromise) {
    offlinePackIndexPromise = fetch(OFFLINE_INDEX_URL).then(async (response) => {
      if (!response.ok) {
        throw new Error('Offline puzzle index is missing');
      }

      return (await response.json()) as OfflinePackIndex;
    });
  }

  return offlinePackIndexPromise;
}

async function loadOfflinePackBlob(): Promise<Blob> {
  if (!offlinePackBlobPromise) {
    offlinePackBlobPromise = fetch(OFFLINE_PGN_URL).then(async (response) => {
      if (!response.ok) {
        throw new Error('Offline puzzle pack is missing');
      }

      return await response.blob();
    });
  }

  return offlinePackBlobPromise;
}

async function loadPuzzleByIndex(index: number): Promise<LoadedOfflinePuzzle> {
  if (!puzzleCache.has(index)) {
    puzzleCache.set(
      index,
      (async () => {
        const packIndex = await loadOfflinePackIndex();
        if (!Number.isInteger(index) || index < 0 || index >= packIndex.count) {
          throw new Error('Puzzle not found');
        }

        const packBlob = await loadOfflinePackBlob();
        const start = packIndex.offsets[index];
        const end = packIndex.offsets[index + 1] ?? packIndex.totalBytes;

        if (typeof start !== 'number' || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
          throw new Error('Offline puzzle pack is corrupted');
        }

        const pgnText = await packBlob.slice(start, end).text();
        const parsed = parsePuzzlePgn(pgnText, `offline-pack:${index + 1}`);
        const title = parsed.title === 'Untitled Puzzle' ? puzzleTitleFromIndex(index) : parsed.title;

        return {
          index,
          publicId: puzzlePublicIdFromIndex(index),
          title,
          startFen: parsed.startFen,
          parsed
        };
      })()
    );
  }

  const cached = puzzleCache.get(index);
  if (!cached) {
    throw new Error('Puzzle not found');
  }

  return cached;
}

function toStatePayload(snapshot: {
  nodeId: number;
  fen: string;
  toMove: 'w' | 'b';
  variationMode: CoreVariationMode;
  lineIndex: number;
  totalLines: number;
  completedBranches: number;
}): SessionStatePayload {
  return {
    nodeId: snapshot.nodeId,
    fen: snapshot.fen,
    toMove: snapshot.toMove,
    variationMode: snapshot.variationMode,
    lineIndex: snapshot.lineIndex,
    totalLines: snapshot.totalLines,
    completedBranches: snapshot.completedBranches
  };
}

function toHintPreview(preview: { pieceFromSquare: string | null; bestMoveUci: string | null }): HintPreview {
  return {
    pieceFromSquare: preview.pieceFromSquare,
    bestMoveUci: preview.bestMoveUci
  };
}

function classifyHistoryStatus(session: OfflineSessionRecord): SessionHistoryItem['status'] {
  if (session.revealed || !session.solved) {
    return 'incorrect';
  }

  if (session.wrongMoveCount > 0 || session.hintCount > 0) {
    return 'half';
  }

  return 'correct';
}

function clampHistoryLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 24;
  }

  return Math.min(200, Math.max(1, Math.floor(limit)));
}

async function chooseRandomPuzzleIndex(excludeIndex?: number): Promise<number> {
  const packIndex = await loadOfflinePackIndex();
  if (packIndex.count <= 0) {
    throw new Error('No offline puzzles are bundled');
  }

  if (packIndex.count === 1) {
    return 0;
  }

  let nextIndex = Math.floor(Math.random() * packIndex.count);
  if (excludeIndex === undefined || nextIndex !== excludeIndex) {
    return nextIndex;
  }

  nextIndex = (nextIndex + 1 + Math.floor(Math.random() * Math.max(1, packIndex.count - 1))) % packIndex.count;
  return nextIndex;
}

function getEngine(puzzle: LoadedOfflinePuzzle, mode: VariationMode): PuzzleSessionEngine {
  return new PuzzleSessionEngine({
    nodes: puzzle.parsed.nodes,
    rootNodeId: puzzle.parsed.rootNode.id,
    mode
  });
}

function activatePrefetchedSession(session: OfflineSessionRecord): void {
  if (!session.prefetched) {
    return;
  }

  session.prefetched = false;
  session.createdAt = new Date().toISOString();
}

async function toStartSessionResponse(
  session: OfflineSessionRecord,
  autoNextDefault: boolean
): Promise<StartSessionResponse> {
  const puzzle = await loadPuzzleByIndex(session.puzzleIndex);
  const engine = getEngine(puzzle, session.mode);
  const snapshot = engine.buildSnapshot(session.cursor, session.solved);
  const hintPreview = toHintPreview(engine.hint(session.cursor));

  session.nodeId = snapshot.nodeId;

  return {
    sessionId: session.id,
    puzzle: {
      publicId: puzzle.publicId,
      startFen: puzzle.startFen,
      title: puzzle.title
    },
    state: toStatePayload(snapshot),
    ui: {
      autoNextDefault,
      hintPreview
    }
  };
}

async function createSessionResponse(
  puzzleIndex: number,
  mode: VariationMode,
  autoNextDefault: boolean,
  prefetched = false
): Promise<StartSessionResponse> {
  const store = readStore();
  const puzzle = await loadPuzzleByIndex(puzzleIndex);
  const engine = getEngine(puzzle, mode);
  const cursor = engine.getInitialCursor();
  const snapshot = engine.buildSnapshot(cursor, false);
  const session: OfflineSessionRecord = {
    id: createSessionId(),
    puzzleIndex,
    mode,
    cursor,
    nodeId: snapshot.nodeId,
    createdAt: new Date().toISOString(),
    solved: false,
    revealed: false,
    autoplayUsed: false,
    wrongMoveCount: 0,
    hintCount: 0,
    prefetched
  };

  store.sessions[session.id] = session;
  writeStore(store);
  return toStartSessionResponse(session, autoNextDefault);
}

async function getSessionContext(sessionId: string, activatePrefetched: boolean): Promise<{
  store: OfflineStore;
  session: OfflineSessionRecord;
  puzzle: LoadedOfflinePuzzle;
  engine: PuzzleSessionEngine;
}> {
  const store = readStore();
  const session = store.sessions[sessionId];
  if (!session) {
    throw new Error('Session not found');
  }

  if (activatePrefetched) {
    activatePrefetchedSession(session);
    writeStore(store);
  }

  const puzzle = await loadPuzzleByIndex(session.puzzleIndex);
  const engine = getEngine(puzzle, session.mode);
  return { store, session, puzzle, engine };
}

function sortedHistorySessions(store: OfflineStore): OfflineSessionRecord[] {
  return Object.values(store.sessions)
    .filter((session) => !session.prefetched)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function mapTreeNodes(puzzle: LoadedOfflinePuzzle): SessionTreeResponse['nodes'] {
  return puzzle.parsed.nodes.map((node) => ({
    id: node.id,
    parent_id: node.parentId,
    ply: node.ply,
    san: node.san,
    uci: node.uci,
    fen_after: node.fenAfter,
    is_mainline: node.isMainline,
    sibling_order: node.siblingOrder,
    actor: node.actor
  }));
}

export async function startSession(
  mode: VariationMode,
  autoNext: boolean,
  puzzleId?: string,
  _source: 'normal' | 'history' = 'normal'
): Promise<StartSessionResponse> {
  if (puzzleId) {
    const puzzleIndex = puzzleIndexFromPublicId(puzzleId);
    if (puzzleIndex === null) {
      throw new Error('Puzzle not found');
    }

    const packIndex = await loadOfflinePackIndex();
    if (puzzleIndex >= packIndex.count) {
      throw new Error('Puzzle not found');
    }

    return createSessionResponse(puzzleIndex, mode, autoNext);
  }

  const puzzleIndex = await chooseRandomPuzzleIndex();
  return createSessionResponse(puzzleIndex, mode, autoNext);
}

export async function playMove(
  sessionId: string,
  uciMove: string,
  skipSimilarVariations = false
): Promise<MoveResponse> {
  const { store, session, engine } = await getSessionContext(sessionId, true);
  const result = engine.playUserMove(session.cursor, uciMove, {
    skipSimilarVariations
  });

  session.cursor = result.cursor;
  session.nodeId = result.snapshot.nodeId;
  session.solved = result.solved;
  session.wrongMoveCount += result.result === 'incorrect' ? 1 : 0;
  writeStore(store);

  return {
    result: result.result,
    bestMoveUci: result.expectedBestMoveUci,
    autoPlayedMoves: result.autoPlayedMoves,
    autoPlayStartFen: result.autoPlayStartFen ?? null,
    rewindFens: result.rewindFens ?? [],
    skippedSimilarVariations: result.skippedSimilarVariations,
    nextState: toStatePayload(result.snapshot),
    completedBranches: result.snapshot.completedBranches,
    totalBranches: result.snapshot.totalLines,
    ui: {
      hintPreview: toHintPreview(engine.hint(result.cursor))
    }
  };
}

export async function loadSession(sessionId: string): Promise<StartSessionResponse> {
  const { session } = await getSessionContext(sessionId, true);
  return toStartSessionResponse(session, true);
}

export async function refreshSession(sessionId: string): Promise<StartSessionResponse> {
  const { session } = await getSessionContext(sessionId, true);
  return toStartSessionResponse(session, true);
}

export async function restartSession(
  sessionId: string,
  mode: VariationMode,
  autoNext: boolean
): Promise<StartSessionResponse> {
  const { store, session, puzzle } = await getSessionContext(sessionId, true);
  const engine = getEngine(puzzle, mode);
  const cursor = engine.getInitialCursor();
  const snapshot = engine.buildSnapshot(cursor, false);

  session.mode = mode;
  session.cursor = cursor;
  session.nodeId = snapshot.nodeId;
  session.solved = false;
  session.revealed = false;
  session.autoplayUsed = false;
  session.wrongMoveCount = 0;
  session.hintCount = 0;
  writeStore(store);

  return toStartSessionResponse(session, autoNext);
}

export async function getHint(sessionId: string): Promise<HintResponse> {
  const { store, session, engine } = await getSessionContext(sessionId, true);
  const hint = engine.hint(session.cursor);

  session.nodeId = hint.snapshot.nodeId;
  if (hint.pieceFromSquare) {
    session.hintCount += 1;
  }
  writeStore(store);

  return {
    pieceFromSquare: hint.pieceFromSquare,
    bestMoveUci: hint.bestMoveUci,
    state: toStatePayload(hint.snapshot)
  };
}

export async function getSessionHistory(
  sessionId: string,
  limit = 24,
  includeCurrent = false
): Promise<SessionHistoryResponse> {
  const store = readStore();
  if (!store.sessions[sessionId]) {
    throw new Error('Session not found');
  }

  const items = sortedHistorySessions(store)
    .filter((session) => includeCurrent || session.id !== sessionId)
    .slice(0, clampHistoryLimit(limit))
    .map((session) => ({
      sessionId: session.id,
      puzzlePublicId: puzzlePublicIdFromIndex(session.puzzleIndex),
      puzzleTitle: puzzleTitleFromIndex(session.puzzleIndex),
      createdAt: session.createdAt,
      status: classifyHistoryStatus(session),
      autoplayUsed: session.autoplayUsed,
      wrongMoveCount: session.wrongMoveCount,
      hintCount: session.hintCount,
      solved: session.solved,
      revealed: session.revealed
    }));

  return { items };
}

export async function clearSessionHistory(sessionId: string): Promise<SessionHistoryClearResponse> {
  const store = readStore();
  if (!store.sessions[sessionId]) {
    throw new Error('Session not found');
  }

  let cleared = 0;
  for (const [id, session] of Object.entries(store.sessions)) {
    if (id === sessionId || session.prefetched) {
      continue;
    }

    delete store.sessions[id];
    cleared += 1;
  }

  writeStore(store);
  return { cleared };
}

export async function getSessionTree(sessionId: string): Promise<SessionTreeResponse> {
  const { session, puzzle } = await getSessionContext(sessionId, false);
  return {
    puzzle: {
      publicId: puzzle.publicId,
      title: puzzle.title,
      startFen: puzzle.startFen
    },
    currentNodeId: session.nodeId || puzzle.parsed.rootNode.id,
    nodes: mapTreeNodes(puzzle)
  };
}

export async function getPuzzleCount(): Promise<PuzzleCountResponse> {
  const packIndex = await loadOfflinePackIndex();
  return {
    count: packIndex.count
  };
}

export async function revealSolution(
  sessionId: string,
  source: 'manual' | 'auto' = 'manual',
  skipSimilarVariations = false
): Promise<RevealResponse> {
  const { store, session, engine } = await getSessionContext(sessionId, true);
  const result = engine.reveal(session.cursor, {
    skipSimilarVariations
  });

  session.cursor = result.cursor;
  session.nodeId = result.snapshot.nodeId;
  session.solved = result.solved;
  session.revealed = true;
  session.autoplayUsed = session.autoplayUsed || source === 'auto';
  writeStore(store);

  return {
    bestMoveUci: result.bestMoveUci,
    bestMoveSan: result.bestMoveSan,
    afterFen: result.afterFen,
    autoPlayedMoves: result.autoPlayedMoves,
    autoPlayStartFen: result.autoPlayStartFen,
    rewindFens: result.rewindFens,
    skippedSimilarVariations: result.skippedSimilarVariations,
    nextState: toStatePayload(result.snapshot),
    ui: {
      hintPreview: toHintPreview(engine.hint(result.cursor))
    }
  };
}

export async function skipVariation(
  sessionId: string,
  skipSimilarVariations = false
): Promise<SkipVariationResponse> {
  const { store, session, engine } = await getSessionContext(sessionId, true);
  const result = engine.skipVariation(session.cursor, {
    skipSimilarVariations
  });

  session.cursor = result.cursor;
  session.nodeId = result.snapshot.nodeId;
  session.solved = result.solved;
  writeStore(store);

  return {
    skipped: result.skipped,
    autoPlayedMoves: result.autoPlayedMoves,
    autoPlayStartFen: result.autoPlayStartFen,
    rewindFens: result.rewindFens,
    skippedSimilarVariations: result.skippedSimilarVariations,
    nextState: toStatePayload(result.snapshot),
    remainingBranches: result.remainingBranches,
    ui: {
      hintPreview: toHintPreview(engine.hint(result.cursor))
    }
  };
}

export async function nextPuzzle(
  sessionId: string,
  mode: VariationMode,
  autoNext: boolean
): Promise<NextResponse> {
  const store = readStore();
  const currentSession = store.sessions[sessionId];
  if (!currentSession) {
    throw new Error('Session not found');
  }

  const prefetched = Object.values(store.sessions)
    .filter((session) => session.prefetched && session.mode === mode && session.id !== sessionId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];

  if (prefetched) {
    activatePrefetchedSession(prefetched);
    writeStore(store);
    const response = await toStartSessionResponse(prefetched, autoNext);
    return {
      newSessionId: response.sessionId,
      puzzle: response.puzzle,
      state: response.state,
      ui: response.ui
    };
  }

  const response = await createSessionResponse(await chooseRandomPuzzleIndex(currentSession.puzzleIndex), mode, autoNext);
  return {
    newSessionId: response.sessionId,
    puzzle: response.puzzle,
    state: response.state,
    ui: response.ui
  };
}

export async function prefetchNextPuzzle(
  sessionId: string,
  mode: VariationMode,
  autoNext: boolean
): Promise<StartSessionResponse> {
  const store = readStore();
  const currentSession = store.sessions[sessionId];
  if (!currentSession) {
    throw new Error('Session not found');
  }

  for (const [id, session] of Object.entries(store.sessions)) {
    if (session.prefetched) {
      delete store.sessions[id];
    }
  }
  writeStore(store);

  return createSessionResponse(await chooseRandomPuzzleIndex(currentSession.puzzleIndex), mode, autoNext, true);
}
