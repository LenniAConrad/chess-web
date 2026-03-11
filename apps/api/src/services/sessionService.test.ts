import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parsePuzzlePgn } from '@chess-web/chess-core';
import {
  createDbPool,
  insertPuzzle,
  insertPuzzleNode,
  runMigrations,
  setPuzzleRootNode,
  upsertAnonSession,
  type InsertPuzzleNodeInput
} from '@chess-web/db';
import type { Pool } from 'pg';
import { SessionService } from './sessionService.js';

const SAMPLE_PGN = `[SetUp "1"]
[FEN "6n1/1P2k2r/3r1b2/R2p1b1p/pp2NP2/1n6/7R/7K w - - 4 63"]

63. Nxd6 Be4+ (Kxd6 64. b8=Q+) 64. Nxe4 Nxa5 65. b8=Q *`;

async function seedOnePuzzle(pool: Pool): Promise<void> {
  const parsed = parsePuzzlePgn(SAMPLE_PGN, 'test');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const puzzle = await insertPuzzle(client, {
      title: parsed.title,
      startFen: parsed.startFen,
      source: 'test',
      randomBucket: 1,
      randomKey: 0.5
    });

    const idMap = new Map<number, number>();
    for (const node of parsed.nodes) {
      const input: InsertPuzzleNodeInput = {
        puzzleId: puzzle.id,
        parentId: node.parentId === null ? null : (idMap.get(node.parentId) ?? null),
        ply: node.ply,
        san: node.san,
        uci: node.uci,
        fenAfter: node.fenAfter,
        isMainline: node.isMainline,
        siblingOrder: node.siblingOrder,
        actor: node.actor
      };
      const inserted = await insertPuzzleNode(client, input);
      idMap.set(node.id, inserted.id);
    }

    const rootNodeId = idMap.get(parsed.rootNode.id);
    if (!rootNodeId) {
      throw new Error('Missing root node id');
    }

    await setPuzzleRootNode(client, puzzle.id, rootNodeId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createServiceContext() {
  const pool = createDbPool('pgmem://local');
  await runMigrations(pool);
  await pool.query('DELETE FROM puzzle_sessions');
  await pool.query('DELETE FROM puzzle_nodes');
  await pool.query('DELETE FROM puzzles');
  await pool.query('DELETE FROM anon_sessions');
  await pool.query('DELETE FROM daily_metrics');
  await pool.query('DELETE FROM rate_limit_events');
  await seedOnePuzzle(pool);

  const anonSessionId = randomUUID();
  await upsertAnonSession(pool, anonSessionId, 'ua-hash', 'ip-hash');

  return {
    pool,
    anonSessionId,
    service: new SessionService(pool)
  };
}

describe('SessionService', () => {
  it('returns hint bestMoveUci and session tree for session owner', async () => {
    const ctx = await createServiceContext();
    try {
      const started = await ctx.service.startRandomSession({
        anonSessionId: ctx.anonSessionId,
        mode: 'explore',
        autoNext: true
      });

      const hint = await ctx.service.hint({ sessionId: started.sessionId });
      expect(hint.pieceFromSquare).toBe('e4');
      expect(hint.bestMoveUci).toBe('e4d6');

      const tree = await ctx.service.getSessionTree({
        sessionId: started.sessionId,
        anonSessionId: ctx.anonSessionId
      });
      expect(tree.currentNodeId).toBe(started.state.nodeId);
      expect(tree.nodes.length).toBeGreaterThan(0);

      await expect(
        ctx.service.getSessionTree({
          sessionId: started.sessionId,
          anonSessionId: randomUUID()
        })
      ).rejects.toThrow('Session not found');
    } finally {
      await ctx.pool.end();
    }
  });

  it('loads an existing history session by sessionId without cloning', async () => {
    const ctx = await createServiceContext();
    try {
      const started = await ctx.service.startRandomSession({
        anonSessionId: ctx.anonSessionId,
        mode: 'explore',
        autoNext: true
      });

      const move = await ctx.service.playMove({
        sessionId: started.sessionId,
        uciMove: 'e4d6'
      });

      const loaded = await ctx.service.loadSession({
        sessionId: started.sessionId,
        anonSessionId: ctx.anonSessionId
      });

      expect(loaded.sessionId).toBe(started.sessionId);
      expect(loaded.puzzle.publicId).toBe(started.puzzle.publicId);
      expect(loaded.state.nodeId).toBe(move.nextState.nodeId);
      expect(loaded.state.fen).toBe(move.nextState.fen);
      expect(loaded.state.lineIndex).toBe(move.nextState.lineIndex);
      expect(loaded.state.completedBranches).toBe(move.nextState.completedBranches);

      await expect(
        ctx.service.loadSession({
          sessionId: started.sessionId,
          anonSessionId: randomUUID()
        })
      ).rejects.toThrow('Session not found');
    } finally {
      await ctx.pool.end();
    }
  });

  it('classifies history statuses and applies limit', async () => {
    const ctx = await createServiceContext();
    try {
      const correct = await ctx.service.startRandomSession({
        anonSessionId: ctx.anonSessionId,
        mode: 'mainline',
        autoNext: true
      });
      await ctx.service.playMove({ sessionId: correct.sessionId, uciMove: 'e4d6' });
      await ctx.service.playMove({ sessionId: correct.sessionId, uciMove: 'd6e4' });
      await ctx.service.playMove({ sessionId: correct.sessionId, uciMove: 'b7b8q' });

      const half = await ctx.service.startRandomSession({
        anonSessionId: ctx.anonSessionId,
        mode: 'mainline',
        autoNext: true
      });
      await ctx.service.hint({ sessionId: half.sessionId });
      await ctx.service.playMove({ sessionId: half.sessionId, uciMove: 'e4d6' });
      await ctx.service.playMove({ sessionId: half.sessionId, uciMove: 'd6e4' });
      await ctx.service.playMove({ sessionId: half.sessionId, uciMove: 'b7b8q' });

      const incorrect = await ctx.service.startRandomSession({
        anonSessionId: ctx.anonSessionId,
        mode: 'mainline',
        autoNext: true
      });
      await ctx.service.reveal({ sessionId: incorrect.sessionId });

      const autoplay = await ctx.service.startRandomSession({
        anonSessionId: ctx.anonSessionId,
        mode: 'mainline',
        autoNext: true
      });
      await ctx.service.reveal({ sessionId: autoplay.sessionId, source: 'auto' });

      const historyOpenedUntouched = await ctx.service.startSessionByPublicId({
        anonSessionId: ctx.anonSessionId,
        mode: 'mainline',
        autoNext: true,
        publicId: correct.puzzle.publicId,
        startedFromHistory: true
      });

      const historyOpenedInteracted = await ctx.service.startSessionByPublicId({
        anonSessionId: ctx.anonSessionId,
        mode: 'mainline',
        autoNext: true,
        publicId: correct.puzzle.publicId,
        startedFromHistory: true
      });
      await ctx.service.hint({ sessionId: historyOpenedInteracted.sessionId });

      const current = await ctx.service.startRandomSession({
        anonSessionId: ctx.anonSessionId,
        mode: 'mainline',
        autoNext: true
      });

      const history = await ctx.service.getSessionHistory({
        sessionId: current.sessionId,
        anonSessionId: ctx.anonSessionId,
        limit: 20
      });

      expect(history.items.length).toBeGreaterThanOrEqual(5);
      const statusBySessionId = new Map(history.items.map((item) => [item.sessionId, item.status]));
      const autoplayBySessionId = new Map(history.items.map((item) => [item.sessionId, item.autoplayUsed]));
      expect(statusBySessionId.get(correct.sessionId)).toBe('correct');
      expect(statusBySessionId.get(half.sessionId)).toBe('half');
      expect(statusBySessionId.get(incorrect.sessionId)).toBe('incorrect');
      expect(statusBySessionId.get(autoplay.sessionId)).toBe('incorrect');
      expect(statusBySessionId.get(historyOpenedInteracted.sessionId)).toBe('incorrect');
      expect(statusBySessionId.has(historyOpenedUntouched.sessionId)).toBe(false);
      expect(autoplayBySessionId.get(correct.sessionId)).toBe(false);
      expect(autoplayBySessionId.get(incorrect.sessionId)).toBe(false);
      expect(autoplayBySessionId.get(autoplay.sessionId)).toBe(true);
      expect(statusBySessionId.has(current.sessionId)).toBe(false);

      const historyWithCurrent = await ctx.service.getSessionHistory({
        sessionId: current.sessionId,
        anonSessionId: ctx.anonSessionId,
        limit: 20,
        includeCurrent: true
      });
      expect(historyWithCurrent.items.some((item) => item.sessionId === current.sessionId)).toBe(true);

      const limited = await ctx.service.getSessionHistory({
        sessionId: current.sessionId,
        anonSessionId: ctx.anonSessionId,
        limit: 1
      });
      expect(limited.items).toHaveLength(1);

      const clearResult = await ctx.service.clearSessionHistory({
        sessionId: current.sessionId,
        anonSessionId: ctx.anonSessionId
      });
      expect(clearResult.cleared).toBeGreaterThanOrEqual(6);

      const afterClear = await ctx.service.getSessionHistory({
        sessionId: current.sessionId,
        anonSessionId: ctx.anonSessionId,
        limit: 20
      });
      expect(afterClear.items).toHaveLength(0);
    } finally {
      await ctx.pool.end();
    }
  });

  it('reuses the oldest untouched session for auto-next before creating a new one', async () => {
    const ctx = await createServiceContext();
    try {
      const firstUntouched = await ctx.service.startRandomSession({
        anonSessionId: ctx.anonSessionId,
        mode: 'explore',
        autoNext: true
      });

      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });

      const secondUntouched = await ctx.service.startRandomSession({
        anonSessionId: ctx.anonSessionId,
        mode: 'explore',
        autoNext: true
      });

      const current = await ctx.service.startRandomSession({
        anonSessionId: ctx.anonSessionId,
        mode: 'explore',
        autoNext: true
      });

      const nextFromQueue = await ctx.service.startNext({
        sessionId: current.sessionId,
        anonSessionId: ctx.anonSessionId,
        autoNext: true
      });

      expect(nextFromQueue.newSessionId).toBe(firstUntouched.sessionId);

      const nextFromQueueAgain = await ctx.service.startNext({
        sessionId: nextFromQueue.newSessionId,
        anonSessionId: ctx.anonSessionId,
        autoNext: true
      });

      expect(nextFromQueueAgain.newSessionId).toBe(secondUntouched.sessionId);
    } finally {
      await ctx.pool.end();
    }
  });
});
