import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { PuzzleSessionRecord, VariationMode } from '../types.js';

function mapSession(row: Record<string, unknown>): PuzzleSessionRecord {
  return {
    id: String(row.id),
    anon_session_id: String(row.anon_session_id),
    puzzle_id: Number(row.puzzle_id),
    mode: row.mode as VariationMode,
    node_id: row.node_id === null ? null : Number(row.node_id),
    branch_cursor: (row.branch_cursor ?? {}) as Record<string, unknown>,
    solved: Boolean(row.solved),
    revealed: Boolean(row.revealed)
  };
}

export async function upsertAnonSession(
  pool: Pool,
  sessionId: string,
  uaHash: string,
  ipHash: string
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO anon_sessions(id, ua_hash, ip_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (id)
     DO UPDATE SET last_seen_at = now(), ua_hash = EXCLUDED.ua_hash, ip_hash = EXCLUDED.ip_hash
     RETURNING id`,
    [sessionId, uaHash, ipHash]
  );

  return String(result.rows[0].id);
}

export async function createPuzzleSession(
  pool: Pool,
  input: {
    anonSessionId: string;
    puzzleId: number;
    mode: VariationMode;
    nodeId: number;
    branchCursor: Record<string, unknown>;
  }
): Promise<PuzzleSessionRecord> {
  const sessionId = randomUUID();
  const result = await pool.query(
    `INSERT INTO puzzle_sessions(id, anon_session_id, puzzle_id, mode, node_id, branch_cursor)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      sessionId,
      input.anonSessionId,
      input.puzzleId,
      input.mode,
      input.nodeId,
      JSON.stringify(input.branchCursor)
    ]
  );

  return mapSession(result.rows[0] as Record<string, unknown>);
}

export async function getPuzzleSession(pool: Pool, sessionId: string): Promise<PuzzleSessionRecord | null> {
  const result = await pool.query('SELECT * FROM puzzle_sessions WHERE id = $1', [sessionId]);
  return result.rowCount ? mapSession(result.rows[0] as Record<string, unknown>) : null;
}

export async function updatePuzzleSession(
  pool: Pool,
  input: {
    sessionId: string;
    nodeId: number;
    branchCursor: Record<string, unknown>;
    solved: boolean;
    revealed: boolean;
  }
): Promise<PuzzleSessionRecord> {
  const result = await pool.query(
    `UPDATE puzzle_sessions
     SET node_id = $2,
         branch_cursor = $3,
         solved = $4,
         revealed = $5,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      input.sessionId,
      input.nodeId,
      JSON.stringify(input.branchCursor),
      input.solved,
      input.revealed
    ]
  );

  return mapSession(result.rows[0] as Record<string, unknown>);
}
