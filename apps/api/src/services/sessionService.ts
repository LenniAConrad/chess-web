import {
  PuzzleSessionEngine,
  type PuzzleNode as CorePuzzleNode,
  type VariationMode
} from '@chess-web/chess-core';
import {
  clearPuzzleSessionHistory,
  createPuzzleSession,
  getPuzzleById,
  getPuzzleByPublicId,
  getPuzzleNodes,
  getPuzzleSession,
  getRandomPuzzle,
  listPuzzleSessionHistory,
  updatePuzzleSession,
  type PuzzleSessionHistoryRecord,
  type PuzzleNodeRecord,
  type PuzzleRecord,
  type PuzzleSessionRecord
} from '@chess-web/db';
import type { Pool } from 'pg';

interface SessionContext {
  dbSession: PuzzleSessionRecord;
  puzzle: PuzzleRecord;
  nodes: PuzzleNodeRecord[];
  engine: PuzzleSessionEngine;
}

export type SessionHistoryStatus = 'correct' | 'half' | 'incorrect';

export interface SessionHistoryItem {
  sessionId: string;
  puzzlePublicId: string;
  puzzleTitle: string;
  createdAt: string;
  status: SessionHistoryStatus;
  autoplayUsed: boolean;
  wrongMoveCount: number;
  hintCount: number;
  solved: boolean;
  revealed: boolean;
}

function classifyHistoryStatus(item: PuzzleSessionHistoryRecord): SessionHistoryStatus {
  if (item.revealed || !item.solved) {
    return 'incorrect';
  }

  if (item.wrong_move_count > 0 || item.hint_count > 0) {
    return 'half';
  }

  return 'correct';
}

function toCoreNodes(nodes: PuzzleNodeRecord[]): CorePuzzleNode[] {
  return nodes.map((node) => ({
    id: node.id,
    parentId: node.parent_id,
    ply: node.ply,
    san: node.san,
    uci: node.uci,
    actor: node.actor,
    isMainline: node.is_mainline,
    siblingOrder: node.sibling_order,
    fenAfter: node.fen_after
  }));
}

function rootNodeIdForPuzzle(puzzle: PuzzleRecord, nodes: PuzzleNodeRecord[]): number {
  if (puzzle.root_node_id) {
    return puzzle.root_node_id;
  }

  const root = nodes.find((node) => node.parent_id === null);
  if (!root) {
    throw new Error('Puzzle root node missing');
  }

  return root.id;
}

export interface SessionStatePayload {
  nodeId: number;
  fen: string;
  toMove: 'w' | 'b';
  variationMode: VariationMode;
  lineIndex: number;
  totalLines: number;
  completedBranches: number;
}

function toStatePayload(snapshot: {
  nodeId: number;
  fen: string;
  toMove: 'w' | 'b';
  variationMode: VariationMode;
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

export class SessionService {
  constructor(private readonly pool: Pool) {}

  private async startSessionForPuzzle(input: {
    anonSessionId: string;
    mode: VariationMode;
    autoNext: boolean;
    startedFromHistory?: boolean;
    puzzle: PuzzleRecord;
  }): Promise<{
    sessionId: string;
    puzzle: { publicId: string; startFen: string; title: string };
    state: SessionStatePayload;
    ui: { autoNextDefault: boolean };
  }> {
    const nodes = await getPuzzleNodes(this.pool, input.puzzle.id);
    const rootNodeId = rootNodeIdForPuzzle(input.puzzle, nodes);
    const engine = new PuzzleSessionEngine({
      nodes: toCoreNodes(nodes),
      rootNodeId,
      mode: input.mode
    });

    const initialCursor = engine.getInitialCursor();
    const snapshot = engine.buildSnapshot(initialCursor, false);

    const dbSession = await createPuzzleSession(this.pool, {
      anonSessionId: input.anonSessionId,
      puzzleId: input.puzzle.id,
      mode: input.mode,
      nodeId: snapshot.nodeId,
      branchCursor: initialCursor as unknown as Record<string, unknown>,
      startedFromHistory: input.startedFromHistory ?? false
    });

    await this.incrementDailyMetric('puzzles_started');

    return {
      sessionId: dbSession.id,
      puzzle: {
        publicId: input.puzzle.public_id,
        startFen: input.puzzle.start_fen,
        title: input.puzzle.title
      },
      state: toStatePayload(snapshot),
      ui: {
        autoNextDefault: input.autoNext
      }
    };
  }

  async startRandomSession(input: {
    anonSessionId: string;
    mode: VariationMode;
    autoNext: boolean;
    excludePuzzleId?: number;
    startedFromHistory?: boolean;
  }): Promise<{
    sessionId: string;
    puzzle: { publicId: string; startFen: string; title: string };
    state: SessionStatePayload;
    ui: { autoNextDefault: boolean };
  }> {
    const puzzle = await getRandomPuzzle(this.pool, input.excludePuzzleId);
    if (!puzzle) {
      throw new Error('No puzzles available in the database');
    }

    return this.startSessionForPuzzle({
      anonSessionId: input.anonSessionId,
      mode: input.mode,
      autoNext: input.autoNext,
      startedFromHistory: input.startedFromHistory,
      puzzle
    });
  }

  async startSessionByPublicId(input: {
    anonSessionId: string;
    mode: VariationMode;
    autoNext: boolean;
    publicId: string;
    startedFromHistory?: boolean;
  }): Promise<{
    sessionId: string;
    puzzle: { publicId: string; startFen: string; title: string };
    state: SessionStatePayload;
    ui: { autoNextDefault: boolean };
  }> {
    const puzzle = await this.findPuzzleByPublicId(input.publicId);
    return this.startSessionForPuzzle({
      anonSessionId: input.anonSessionId,
      mode: input.mode,
      autoNext: input.autoNext,
      startedFromHistory: input.startedFromHistory,
      puzzle
    });
  }

  async playMove(input: { sessionId: string; uciMove: string }): Promise<{
    result: 'correct' | 'incorrect' | 'completed';
    bestMoveUci?: string;
    autoPlayedMoves: string[];
    autoPlayStartFen: string | null;
    rewindFens: string[];
    nextState: SessionStatePayload;
    completedBranches: number;
    totalBranches: number;
  }> {
    const context = await this.loadContext(input.sessionId);
    const cursor = context.engine.normalizeCursor(context.dbSession.branch_cursor);
    const step = context.engine.playUserMove(cursor, input.uciMove);

    await updatePuzzleSession(this.pool, {
      sessionId: context.dbSession.id,
      nodeId: step.snapshot.nodeId,
      branchCursor: step.cursor as unknown as Record<string, unknown>,
      solved: step.solved,
      revealed: context.dbSession.revealed,
      autoplayUsed: context.dbSession.autoplay_used,
      wrongMoveCount: context.dbSession.wrong_move_count + (step.result === 'incorrect' ? 1 : 0),
      hintCount: context.dbSession.hint_count
    });

    if (step.solved) {
      await this.incrementDailyMetric('puzzles_solved');
    }

    return {
      result: step.result,
      bestMoveUci: step.expectedBestMoveUci,
      autoPlayedMoves: step.autoPlayedMoves,
      autoPlayStartFen: step.autoPlayStartFen ?? null,
      rewindFens: step.rewindFens ?? [],
      nextState: toStatePayload(step.snapshot),
      completedBranches: step.snapshot.completedBranches,
      totalBranches: step.snapshot.totalLines
    };
  }

  async hint(input: { sessionId: string }): Promise<{
    pieceFromSquare: string | null;
    bestMoveUci: string | null;
    state: SessionStatePayload;
  }> {
    const context = await this.loadContext(input.sessionId);
    const cursor = context.engine.normalizeCursor(context.dbSession.branch_cursor);
    const result = context.engine.hint(cursor);

    await updatePuzzleSession(this.pool, {
      sessionId: context.dbSession.id,
      nodeId: result.snapshot.nodeId,
      branchCursor: cursor as unknown as Record<string, unknown>,
      solved: context.dbSession.solved,
      revealed: context.dbSession.revealed,
      autoplayUsed: context.dbSession.autoplay_used,
      wrongMoveCount: context.dbSession.wrong_move_count,
      hintCount: context.dbSession.hint_count + (result.pieceFromSquare ? 1 : 0)
    });

    if (result.pieceFromSquare) {
      await this.incrementDailyMetric('hint_used');
    }

    return {
      pieceFromSquare: result.pieceFromSquare,
      bestMoveUci: result.bestMoveUci,
      state: toStatePayload(result.snapshot)
    };
  }

  async reveal(input: { sessionId: string; source?: 'manual' | 'auto' }): Promise<{
    bestMoveUci: string | null;
    bestMoveSan: string | null;
    afterFen: string | null;
    autoPlayedMoves: string[];
    autoPlayStartFen: string | null;
    rewindFens: string[];
    nextState: SessionStatePayload;
  }> {
    const context = await this.loadContext(input.sessionId);
    const cursor = context.engine.normalizeCursor(context.dbSession.branch_cursor);
    const result = context.engine.reveal(cursor);

    await updatePuzzleSession(this.pool, {
      sessionId: context.dbSession.id,
      nodeId: result.snapshot.nodeId,
      branchCursor: result.cursor as unknown as Record<string, unknown>,
      solved: result.solved,
      revealed: true,
      autoplayUsed: context.dbSession.autoplay_used || input.source === 'auto',
      wrongMoveCount: context.dbSession.wrong_move_count,
      hintCount: context.dbSession.hint_count
    });

    await this.incrementDailyMetric('reveal_used');

    return {
      bestMoveUci: result.bestMoveUci,
      bestMoveSan: result.bestMoveSan,
      afterFen: result.afterFen,
      autoPlayedMoves: result.autoPlayedMoves,
      autoPlayStartFen: result.autoPlayStartFen,
      rewindFens: result.rewindFens,
      nextState: toStatePayload(result.snapshot)
    };
  }

  async skipVariation(input: { sessionId: string }): Promise<{
    skipped: boolean;
    autoPlayedMoves: string[];
    autoPlayStartFen: string | null;
    rewindFens: string[];
    nextState: SessionStatePayload;
    remainingBranches: number;
  }> {
    const context = await this.loadContext(input.sessionId);
    const cursor = context.engine.normalizeCursor(context.dbSession.branch_cursor);
    const result = context.engine.skipVariation(cursor);

    await updatePuzzleSession(this.pool, {
      sessionId: context.dbSession.id,
      nodeId: result.snapshot.nodeId,
      branchCursor: result.cursor as unknown as Record<string, unknown>,
      solved: result.solved,
      revealed: context.dbSession.revealed,
      autoplayUsed: context.dbSession.autoplay_used,
      wrongMoveCount: context.dbSession.wrong_move_count,
      hintCount: context.dbSession.hint_count
    });

    return {
      skipped: result.skipped,
      autoPlayedMoves: result.autoPlayedMoves,
      autoPlayStartFen: result.autoPlayStartFen,
      rewindFens: result.rewindFens,
      nextState: toStatePayload(result.snapshot),
      remainingBranches: result.remainingBranches
    };
  }

  async startNext(input: {
    sessionId: string;
    anonSessionId: string;
    mode?: VariationMode;
    autoNext: boolean;
  }): Promise<{
    newSessionId: string;
    puzzle: { publicId: string; startFen: string; title: string };
    state: SessionStatePayload;
  }> {
    const existing = await getPuzzleSession(this.pool, input.sessionId);
    if (!existing) {
      throw new Error('Session not found');
    }

    const mode = input.mode ?? existing.mode;
    const next = await this.startRandomSession({
      anonSessionId: input.anonSessionId,
      mode,
      autoNext: input.autoNext,
      excludePuzzleId: existing.puzzle_id
    });

    return {
      newSessionId: next.sessionId,
      puzzle: next.puzzle,
      state: next.state
    };
  }

  async loadSession(input: {
    sessionId: string;
    anonSessionId: string;
  }): Promise<{
    sessionId: string;
    puzzle: { publicId: string; startFen: string; title: string };
    state: SessionStatePayload;
    ui: { autoNextDefault: boolean };
  }> {
    const context = await this.loadContext(input.sessionId, input.anonSessionId);
    const cursor = context.engine.normalizeCursor(context.dbSession.branch_cursor);
    const snapshot = context.engine.buildSnapshot(cursor, context.dbSession.solved);

    return {
      sessionId: context.dbSession.id,
      puzzle: {
        publicId: context.puzzle.public_id,
        startFen: context.puzzle.start_fen,
        title: context.puzzle.title
      },
      state: toStatePayload(snapshot),
      ui: {
        autoNextDefault: true
      }
    };
  }

  async getSessionHistory(input: {
    sessionId: string;
    anonSessionId: string;
    limit: number;
    includeCurrent?: boolean;
  }): Promise<{ items: SessionHistoryItem[] }> {
    const session = await getPuzzleSession(this.pool, input.sessionId);
    if (!session || session.anon_session_id !== input.anonSessionId) {
      throw new Error('Session not found');
    }

    const normalizedLimit = Math.min(24, Math.max(1, Math.floor(input.limit)));
    const history = await listPuzzleSessionHistory(
      this.pool,
      input.anonSessionId,
      normalizedLimit,
      input.includeCurrent ? undefined : input.sessionId
    );
    const items = history.map((item) => ({
      sessionId: item.session_id,
      puzzlePublicId: item.puzzle_public_id,
      puzzleTitle: item.puzzle_title,
      createdAt: item.created_at,
      status: classifyHistoryStatus(item),
      autoplayUsed: item.autoplay_used,
      wrongMoveCount: item.wrong_move_count,
      hintCount: item.hint_count,
      solved: item.solved,
      revealed: item.revealed
    }));

    return { items };
  }

  async clearSessionHistory(input: {
    sessionId: string;
    anonSessionId: string;
  }): Promise<{ cleared: number }> {
    const session = await getPuzzleSession(this.pool, input.sessionId);
    if (!session || session.anon_session_id !== input.anonSessionId) {
      throw new Error('Session not found');
    }

    const cleared = await clearPuzzleSessionHistory(this.pool, input.anonSessionId, input.sessionId);
    return { cleared };
  }

  async getSessionTree(input: { sessionId: string; anonSessionId: string }): Promise<{
    puzzle: { publicId: string; title: string; startFen: string };
    currentNodeId: number;
    nodes: PuzzleNodeRecord[];
  }> {
    const context = await this.loadContext(input.sessionId, input.anonSessionId);
    const rootNodeId = rootNodeIdForPuzzle(context.puzzle, context.nodes);

    return {
      puzzle: {
        publicId: context.puzzle.public_id,
        title: context.puzzle.title,
        startFen: context.puzzle.start_fen
      },
      currentNodeId: context.dbSession.node_id ?? rootNodeId,
      nodes: context.nodes
    };
  }

  async getPuzzleTree(publicId: string): Promise<{
    puzzle: { publicId: string; title: string; startFen: string };
    nodes: PuzzleNodeRecord[];
  }> {
    const puzzle = await this.findPuzzleByPublicId(publicId);
    const nodes = await getPuzzleNodes(this.pool, puzzle.id);

    return {
      puzzle: {
        publicId: puzzle.public_id,
        title: puzzle.title,
        startFen: puzzle.start_fen
      },
      nodes
    };
  }

  private async loadContext(sessionId: string, anonSessionId?: string): Promise<SessionContext> {
    const dbSession = await getPuzzleSession(this.pool, sessionId);
    if (!dbSession) {
      throw new Error('Session not found');
    }
    if (anonSessionId && dbSession.anon_session_id !== anonSessionId) {
      throw new Error('Session not found');
    }

    const puzzle = await getPuzzleById(this.pool, dbSession.puzzle_id);
    if (!puzzle) {
      throw new Error('Puzzle not found for session');
    }

    const nodes = await getPuzzleNodes(this.pool, puzzle.id);
    const rootNodeId = rootNodeIdForPuzzle(puzzle, nodes);

    const engine = new PuzzleSessionEngine({
      nodes: toCoreNodes(nodes),
      rootNodeId,
      mode: dbSession.mode
    });

    return { dbSession, puzzle, nodes, engine };
  }

  private async findPuzzleByPublicId(publicId: string): Promise<PuzzleRecord> {
    const puzzle = await getPuzzleByPublicId(this.pool, publicId);
    if (!puzzle) {
      throw new Error('Puzzle not found');
    }

    return puzzle;
  }

  private async incrementDailyMetric(field: 'puzzles_started' | 'puzzles_solved' | 'hint_used' | 'reveal_used') {
    await this.pool.query(
      `INSERT INTO daily_metrics(day, ${field}) VALUES (CURRENT_DATE, 1)
       ON CONFLICT (day)
       DO UPDATE SET ${field} = daily_metrics.${field} + 1`
    );
  }
}
