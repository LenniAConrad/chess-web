import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { MoveActor, PuzzleNodeRecord, PuzzleRecord } from '../types.js';

export interface InsertPuzzleInput {
  title: string;
  startFen: string;
  source: string;
  randomBucket: number;
  randomKey: number;
}

export interface InsertPuzzleNodeInput {
  puzzleId: number;
  parentId: number | null;
  ply: number;
  san: string;
  uci: string;
  fenAfter: string;
  isMainline: boolean;
  siblingOrder: number;
  actor: MoveActor;
}

function mapPuzzle(row: Record<string, unknown>): PuzzleRecord {
  return {
    id: Number(row.id),
    public_id: String(row.public_id),
    title: String(row.title),
    start_fen: String(row.start_fen),
    source: String(row.source),
    random_bucket: Number(row.random_bucket),
    random_key: Number(row.random_key),
    root_node_id: row.root_node_id === null ? null : Number(row.root_node_id)
  };
}

function mapNode(row: Record<string, unknown>): PuzzleNodeRecord {
  return {
    id: Number(row.id),
    puzzle_id: Number(row.puzzle_id),
    parent_id: row.parent_id === null ? null : Number(row.parent_id),
    ply: Number(row.ply),
    san: String(row.san),
    uci: String(row.uci),
    fen_after: String(row.fen_after),
    is_mainline: Boolean(row.is_mainline),
    sibling_order: Number(row.sibling_order),
    actor: row.actor as MoveActor
  };
}

export async function insertPuzzle(client: PoolClient, input: InsertPuzzleInput): Promise<PuzzleRecord> {
  const publicId = randomUUID();
  const result = await client.query(
    `INSERT INTO puzzles(public_id, title, start_fen, source, random_bucket, random_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [publicId, input.title, input.startFen, input.source, input.randomBucket, input.randomKey]
  );

  return mapPuzzle(result.rows[0] as Record<string, unknown>);
}

export async function insertPuzzleNode(
  client: PoolClient,
  input: InsertPuzzleNodeInput
): Promise<PuzzleNodeRecord> {
  const result = await client.query(
    `INSERT INTO puzzle_nodes(
      puzzle_id, parent_id, ply, san, uci, fen_after, is_mainline, sibling_order, actor
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      input.puzzleId,
      input.parentId,
      input.ply,
      input.san,
      input.uci,
      input.fenAfter,
      input.isMainline,
      input.siblingOrder,
      input.actor
    ]
  );

  return mapNode(result.rows[0] as Record<string, unknown>);
}

export async function setPuzzleRootNode(
  client: PoolClient,
  puzzleId: number,
  rootNodeId: number
): Promise<void> {
  await client.query('UPDATE puzzles SET root_node_id = $1 WHERE id = $2', [rootNodeId, puzzleId]);
}

export async function getPuzzleById(pool: Pool, puzzleId: number): Promise<PuzzleRecord | null> {
  const result = await pool.query('SELECT * FROM puzzles WHERE id = $1', [puzzleId]);
  return result.rowCount ? mapPuzzle(result.rows[0] as Record<string, unknown>) : null;
}

export async function getPuzzleByPublicId(pool: Pool, publicId: string): Promise<PuzzleRecord | null> {
  const result = await pool.query('SELECT * FROM puzzles WHERE public_id = $1', [publicId]);
  return result.rowCount ? mapPuzzle(result.rows[0] as Record<string, unknown>) : null;
}

export async function getPuzzleNodes(pool: Pool, puzzleId: number): Promise<PuzzleNodeRecord[]> {
  const result = await pool.query(
    `SELECT * FROM puzzle_nodes
     WHERE puzzle_id = $1
     ORDER BY ply ASC, parent_id ASC NULLS FIRST, sibling_order ASC, id ASC`,
    [puzzleId]
  );

  return result.rows.map((row: Record<string, unknown>) => mapNode(row));
}

export async function getRandomPuzzle(pool: Pool, excludePuzzleId?: number): Promise<PuzzleRecord | null> {
  const bucket = Math.floor(Math.random() * 1024);
  const randomKey = Math.random();
  const excluded = excludePuzzleId ?? null;

  const first = await pool.query(
    `SELECT * FROM puzzles
     WHERE random_bucket = $1
       AND random_key >= $2
       AND ($3::bigint IS NULL OR id <> $3)
     ORDER BY random_key ASC LIMIT 1`,
    [bucket, randomKey, excluded]
  );
  if (first.rowCount && first.rowCount > 0) {
    return mapPuzzle(first.rows[0] as Record<string, unknown>);
  }

  const second = await pool.query(
    `SELECT * FROM puzzles
     WHERE random_bucket = $1
       AND ($2::bigint IS NULL OR id <> $2)
     ORDER BY random_key ASC LIMIT 1`,
    [bucket, excluded]
  );
  if (second.rowCount && second.rowCount > 0) {
    return mapPuzzle(second.rows[0] as Record<string, unknown>);
  }

  const third = await pool.query(
    `SELECT * FROM puzzles
     WHERE random_bucket > $1
       AND ($2::bigint IS NULL OR id <> $2)
     ORDER BY random_bucket ASC, random_key ASC LIMIT 1`,
    [bucket, excluded]
  );
  if (third.rowCount && third.rowCount > 0) {
    return mapPuzzle(third.rows[0] as Record<string, unknown>);
  }

  const fourth = await pool.query(
    `SELECT * FROM puzzles
     WHERE random_bucket < $1
       AND ($2::bigint IS NULL OR id <> $2)
     ORDER BY random_bucket ASC, random_key ASC LIMIT 1`,
    [bucket, excluded]
  );
  if (fourth.rowCount && fourth.rowCount > 0) {
    return mapPuzzle(fourth.rows[0] as Record<string, unknown>);
  }

  if (excluded !== null) {
    const fallback = await pool.query('SELECT * FROM puzzles ORDER BY random_key ASC LIMIT 1');
    if (fallback.rowCount && fallback.rowCount > 0) {
      return mapPuzzle(fallback.rows[0] as Record<string, unknown>);
    }
  }

  return null;
}
