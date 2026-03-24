import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import { split } from '@mliebelt/pgn-parser';
import { parsePuzzlePgn } from '@chess-web/chess-core';
import { insertPuzzle, insertPuzzleNode, setPuzzleRootNode } from '@chess-web/db';
import type { Pool, PoolClient } from 'pg';

export interface PgnImportProgress {
  total: number;
  success: number;
  failed: number;
}

export interface PgnImportResult extends PgnImportProgress {
  jobId: number;
  status: 'completed' | 'completed_with_errors';
}

interface PgnImportOptions {
  replaceExisting?: boolean;
  onProgress?: (progress: PgnImportProgress) => void;
  totalHint?: number;
  progressUpdateEvery?: number;
}

async function* iteratePgnGamesFromFile(filePath: string): AsyncGenerator<string> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const lines = createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  let currentGame: string[] = [];
  let sawMoves = false;

  for await (const line of lines) {
    if (line.startsWith('[') && sawMoves) {
      const game = currentGame.join('\n').trim();
      if (game) {
        yield game;
      }
      currentGame = [line];
      sawMoves = false;
      continue;
    }

    currentGame.push(line);
    if (!sawMoves && line.trim().length > 0 && !line.startsWith('[')) {
      sawMoves = true;
    }
  }

  const finalGame = currentGame.join('\n').trim();
  if (finalGame) {
    yield finalGame;
  }
}

async function importOneGame(client: PoolClient, gameText: string, sourceFile: string): Promise<void> {
  const parsed = parsePuzzlePgn(gameText, sourceFile);
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
}

async function updateJobProgress(
  pool: Pool,
  jobId: number,
  total: number,
  success: number,
  failed: number
): Promise<void> {
  await pool.query(
    `UPDATE puzzle_import_jobs
     SET total = $2,
         success = $3,
         failed = $4
     WHERE id = $1`,
    [jobId, total, success, failed]
  );
}

async function importPgnGames(
  pool: Pool,
  games: AsyncIterable<string>,
  sourceFile: string,
  options?: PgnImportOptions
): Promise<PgnImportResult> {
  const normalizedSource = basename(sourceFile);
  const totalHint = options?.totalHint ?? 0;
  const progressUpdateEvery = options?.progressUpdateEvery ?? 250;

  if (options?.replaceExisting) {
    await pool.query(
      'TRUNCATE TABLE puzzle_sessions, puzzle_nodes, puzzles, puzzle_import_jobs RESTART IDENTITY CASCADE'
    );
  }

  const jobInsert = await pool.query(
    `INSERT INTO puzzle_import_jobs(source_file, total, status)
     VALUES ($1, $2, 'running')
     RETURNING id`,
    [normalizedSource, totalHint]
  );

  const jobId = Number(jobInsert.rows[0].id);
  let success = 0;
  let failed = 0;
  let processed = 0;

  for await (const gameText of games) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await importOneGame(client, gameText, normalizedSource);
      await client.query('COMMIT');
      success += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      failed += 1;
      console.error('Failed to import puzzle game:', error);
    } finally {
      client.release();
    }

    processed += 1;
    const total = totalHint || processed;

    if (processed % progressUpdateEvery === 0) {
      await updateJobProgress(pool, jobId, total, success, failed);
    }

    options?.onProgress?.({
      total,
      success,
      failed
    });
  }

  const total = totalHint || processed;
  const status = failed > 0 ? 'completed_with_errors' : 'completed';
  await pool.query(
    `UPDATE puzzle_import_jobs
     SET total = $2,
         success = $3,
         failed = $4,
         status = $5,
         finished_at = now()
     WHERE id = $1`,
    [jobId, total, success, failed, status]
  );

  return {
    jobId,
    total,
    success,
    failed,
    status
  };
}

export async function importPgnFile(
  pool: Pool,
  filePath: string,
  options?: PgnImportOptions
): Promise<PgnImportResult> {
  return importPgnGames(pool, iteratePgnGamesFromFile(filePath), basename(filePath), options);
}

export async function importPgnText(
  pool: Pool,
  pgnText: string,
  sourceFile: string,
  options?: Omit<PgnImportOptions, 'totalHint'>
): Promise<PgnImportResult> {
  const games = split(pgnText);

  async function* iterateParsedGames(): AsyncGenerator<string> {
    for (const game of games) {
      yield game.all;
    }
  }

  return importPgnGames(pool, iterateParsedGames(), sourceFile, {
    ...options,
    totalHint: games.length
  });
}
