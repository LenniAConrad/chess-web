import './loadEnv.js';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { split } from '@mliebelt/pgn-parser';
import { parsePuzzlePgn } from '@chess-web/chess-core';
import {
  createDbPool,
  insertPuzzle,
  insertPuzzleNode,
  setPuzzleRootNode,
  runMigrations
} from '@chess-web/db';
import { z } from 'zod';

const argsSchema = z.object({
  file: z.string().min(1),
  token: z.string().min(1).optional()
});

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  IMPORT_TOKEN: z.string().min(1)
});

function parseArgs(argv: string[]): { file: string; token?: string } {
  const map = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key || key === '--' || !key.startsWith('--') || key.length <= 2 || !value) {
      continue;
    }
    if (value === '--' || value.startsWith('--')) {
      continue;
    }
    map.set(key.slice(2), value);
    index += 1;
  }

  return argsSchema.parse({
    file: map.get('file'),
    token: map.get('token')
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = envSchema.parse(process.env);
  const providedToken = args.token ?? env.IMPORT_TOKEN;

  if (providedToken !== env.IMPORT_TOKEN) {
    throw new Error('Invalid import token');
  }

  const pool = createDbPool(env.DATABASE_URL);
  await runMigrations(pool);

  const sourceText = await readFile(args.file, 'utf-8');
  const games = split(sourceText);

  let success = 0;
  let failed = 0;

  const sourceFile = basename(args.file);
  const jobInsert = await pool.query(
    `INSERT INTO puzzle_import_jobs(source_file, total, status)
     VALUES ($1, $2, 'running')
     RETURNING id`,
    [sourceFile, games.length]
  );

  const jobId = Number(jobInsert.rows[0].id);

  for (const game of games) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const parsed = parsePuzzlePgn(game.all, sourceFile);
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
  }

  await pool.query(
    `UPDATE puzzle_import_jobs
     SET success = $2,
         failed = $3,
         status = $4,
         finished_at = now()
     WHERE id = $1`,
    [jobId, success, failed, failed > 0 ? 'completed_with_errors' : 'completed']
  );
  console.log(`Import completed. success=${success} failed=${failed}`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
