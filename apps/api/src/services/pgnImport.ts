import { basename } from 'node:path';
import { split } from '@mliebelt/pgn-parser';
import { parsePuzzlePgn } from '@chess-web/chess-core';
import {
  insertPuzzle,
  insertPuzzleNode,
  setPuzzleRootNode
} from '@chess-web/db';
import type { Pool } from 'pg';

export interface PgnImportProgress {
  total: number;
  success: number;
  failed: number;
}

export interface PgnImportResult extends PgnImportProgress {
  jobId: number;
  status: 'completed' | 'completed_with_errors';
}

export async function importPgnText(
  pool: Pool,
  pgnText: string,
  sourceFile: string,
  options?: {
    replaceExisting?: boolean;
    onProgress?: (progress: PgnImportProgress) => void;
  }
): Promise<PgnImportResult> {
  const games = split(pgnText);
  const normalizedSource = basename(sourceFile);

  if (options?.replaceExisting) {
    await pool.query('DELETE FROM puzzles');
  }

  let success = 0;
  let failed = 0;

  const jobInsert = await pool.query(
    `INSERT INTO puzzle_import_jobs(source_file, total, status)
     VALUES ($1, $2, 'running')
     RETURNING id`,
    [normalizedSource, games.length]
  );

  const jobId = Number(jobInsert.rows[0].id);

  for (const game of games) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const parsed = parsePuzzlePgn(game.all, normalizedSource);
      const puzzle = await insertPuzzle(client, {
        title: parsed.title,
        startFen: parsed.startFen,
        source: parsed.source,
        randomBucket: Math.floor(Math.random() * 1024),
        randomKey: Math.random()
      });

      const idMap = new Map<number, number>();
      for (const node of parsed.nodes) {
        const inserted = await insertPuzzleNode(client, {
          puzzleId: puzzle.id,
          parentId: node.parentId === null ? null : idMap.get(node.parentId) ?? null,
          ply: node.ply,
          san: node.san,
          uci: node.uci,
          fenAfter: node.fenAfter,
          isMainline: node.isMainline,
          siblingOrder: node.siblingOrder,
          actor: node.actor
        });
        idMap.set(node.id, inserted.id);
      }

      const rootNodeId = idMap.get(parsed.rootNode.id);
      if (!rootNodeId) {
        throw new Error('Root node insert failed');
      }

      await setPuzzleRootNode(client, puzzle.id, rootNodeId);
      await client.query('COMMIT');
      success += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      failed += 1;
      console.error('Failed to import puzzle game:', error);
    } finally {
      client.release();
    }

    options?.onProgress?.({
      total: games.length,
      success,
      failed
    });
  }

  const status = failed > 0 ? 'completed_with_errors' : 'completed';
  await pool.query(
    `UPDATE puzzle_import_jobs
     SET success = $2,
         failed = $3,
         status = $4,
         finished_at = now()
     WHERE id = $1`,
    [jobId, success, failed, status]
  );

  return {
    jobId,
    total: games.length,
    success,
    failed,
    status
  };
}
