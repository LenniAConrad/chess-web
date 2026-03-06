import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { split } from '@mliebelt/pgn-parser';
import { parsePuzzlePgn } from '@chess-web/chess-core';
import {
  insertPuzzle,
  insertPuzzleNode,
  setPuzzleRootNode,
  type InsertPuzzleNodeInput
} from '@chess-web/db';
import type { Pool } from 'pg';

const BUILTIN_SAMPLE_PGN = `[SetUp "1"]
[FEN "6n1/1P2k2r/3r1b2/R2p1b1p/pp2NP2/1n6/7R/7K w - - 4 63"]

63. Nxd6 Be4+ (Kxd6 64. b8=Q+) 64. Nxe4 Nxa5 65. b8=Q *`;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function importOnePgnText(pool: Pool, pgnText: string, source: string): Promise<void> {
  const parsed = parsePuzzlePgn(pgnText, source);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const puzzle = await insertPuzzle(client, {
      title: parsed.title,
      startFen: parsed.startFen,
      source,
      randomBucket: Math.floor(Math.random() * 1024),
      randomKey: Math.random()
    });

    const idMap = new Map<number, number>();
    for (const node of parsed.nodes) {
      const input: InsertPuzzleNodeInput = {
        puzzleId: puzzle.id,
        parentId: node.parentId === null ? null : idMap.get(node.parentId) ?? null,
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
      throw new Error('Root node insert failed during seed');
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

export async function seedPuzzlesIfEmpty(pool: Pool, seedPath?: string, maxPuzzles = 200): Promise<number> {
  const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM puzzles');
  const count = Number(countResult.rows[0]?.count ?? 0);
  if (count > 0) {
    return count;
  }

  if (seedPath && (await fileExists(seedPath))) {
    const text = await readFile(seedPath, 'utf-8');
    const games = split(text);
    let imported = 0;

    for (const game of games) {
      await importOnePgnText(pool, game.all, seedPath);
      imported += 1;
      if (imported >= maxPuzzles) {
        break;
      }
    }

    return imported;
  }

  await importOnePgnText(pool, BUILTIN_SAMPLE_PGN, 'builtin-sample');
  return 1;
}
