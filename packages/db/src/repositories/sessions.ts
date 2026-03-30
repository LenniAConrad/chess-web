import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { PuzzleSessionHistoryRecord, PuzzleSessionRecord, VariationMode } from '../types.js';

/**
 * Session repository for anon user state, history projection, and counters.
 */
function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function mapSession(row: Record<string, unknown>): PuzzleSessionRecord {
  return {
    id: String(row.id),
    anon_session_id: String(row.anon_session_id),
    puzzle_id: Number(row.puzzle_id),
    mode: row.mode as VariationMode,
    node_id: row.node_id === null ? null : Number(row.node_id),
    branch_cursor: (row.branch_cursor ?? {}) as Record<string, unknown>,
    started_from_history: Boolean(row.started_from_history),
    prefetched: Boolean(row.prefetched),
    solved: Boolean(row.solved),
    revealed: Boolean(row.revealed),
    autoplay_used: Boolean(row.autoplay_used),
    wrong_move_count: Number(row.wrong_move_count ?? 0),
    hint_count: Number(row.hint_count ?? 0),
    created_at: toIsoTimestamp(row.created_at),
    updated_at: toIsoTimestamp(row.updated_at)
  };
}

function mapHistory(row: Record<string, unknown>): PuzzleSessionHistoryRecord {
  return {
    session_id: String(row.session_id),
    puzzle_public_id: String(row.puzzle_public_id),
    puzzle_title: String(row.puzzle_title),
    created_at: toIsoTimestamp(row.created_at),
    solved: Boolean(row.solved),
    revealed: Boolean(row.revealed),
    autoplay_used: Boolean(row.autoplay_used),
    wrong_move_count: Number(row.wrong_move_count ?? 0),
    hint_count: Number(row.hint_count ?? 0)
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
    startedFromHistory?: boolean;
    prefetched?: boolean;
  }
): Promise<PuzzleSessionRecord> {
  const sessionId = randomUUID();
  const result = await pool.query(
    `INSERT INTO puzzle_sessions(
      id, anon_session_id, puzzle_id, mode, node_id, branch_cursor, started_from_history, prefetched
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      sessionId,
      input.anonSessionId,
      input.puzzleId,
      input.mode,
      input.nodeId,
      JSON.stringify(input.branchCursor),
      input.startedFromHistory ?? false,
      input.prefetched ?? false
    ]
  );

  return mapSession(result.rows[0] as Record<string, unknown>);
}

export async function getPuzzleSession(pool: Pool, sessionId: string): Promise<PuzzleSessionRecord | null> {
  const result = await pool.query('SELECT * FROM puzzle_sessions WHERE id = $1', [sessionId]);
  return result.rowCount ? mapSession(result.rows[0] as Record<string, unknown>) : null;
}

export async function getOldestUntouchedPuzzleSession(
  pool: Pool,
  anonSessionId: string,
  excludeSessionId?: string
): Promise<PuzzleSessionRecord | null> {
  // "Untouched" means no solves, hints, wrong moves, reveals, autoplay, or updates beyond creation time.
  const baseQuery = `SELECT *
     FROM puzzle_sessions ps
     WHERE ps.anon_session_id = $1
       AND ps.solved = false
       AND ps.revealed = false
       AND ps.prefetched = false
       AND ps.autoplay_used = false
       AND ps.wrong_move_count = 0
       AND ps.hint_count = 0
       AND ps.updated_at = ps.created_at`;

  const withExcludeQuery = `${baseQuery}
       AND ps.id <> $2
     ORDER BY ps.created_at ASC
     LIMIT 1`;

  const withoutExcludeQuery = `${baseQuery}
     ORDER BY ps.created_at ASC
     LIMIT 1`;

  const result = excludeSessionId
    ? await pool.query(withExcludeQuery, [anonSessionId, excludeSessionId])
    : await pool.query(withoutExcludeQuery, [anonSessionId]);

  return result.rowCount ? mapSession(result.rows[0] as Record<string, unknown>) : null;
}

export async function updatePuzzleSession(
  pool: Pool,
  input: {
    sessionId: string;
    nodeId: number;
    branchCursor: Record<string, unknown>;
    prefetched?: boolean;
    solved: boolean;
    revealed: boolean;
    autoplayUsed: boolean;
    wrongMoveCount: number;
    hintCount: number;
  }
): Promise<PuzzleSessionRecord> {
  const result = await pool.query(
    `UPDATE puzzle_sessions
     SET node_id = $2,
         branch_cursor = $3,
         prefetched = $4,
         solved = $5,
         revealed = $6,
         autoplay_used = $7,
         wrong_move_count = $8,
         hint_count = $9,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      input.sessionId,
      input.nodeId,
      JSON.stringify(input.branchCursor),
      input.prefetched ?? false,
      input.solved,
      input.revealed,
      input.autoplayUsed,
      input.wrongMoveCount,
      input.hintCount
    ]
  );

  return mapSession(result.rows[0] as Record<string, unknown>);
}

export async function resetPuzzleSession(
  pool: Pool,
  input: {
    sessionId: string;
    mode: VariationMode;
    nodeId: number;
    branchCursor: Record<string, unknown>;
    startedFromHistory?: boolean;
  }
): Promise<PuzzleSessionRecord> {
  const result = await pool.query(
    `UPDATE puzzle_sessions
     SET mode = $2,
         node_id = $3,
         branch_cursor = $4,
         started_from_history = $5,
         prefetched = false,
         solved = false,
         revealed = false,
         autoplay_used = false,
         wrong_move_count = 0,
         hint_count = 0,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      input.sessionId,
      input.mode,
      input.nodeId,
      JSON.stringify(input.branchCursor),
      input.startedFromHistory ?? false
    ]
  );

  return mapSession(result.rows[0] as Record<string, unknown>);
}

export async function setPuzzleSessionPrefetched(
  pool: Pool,
  input: {
    sessionId: string;
    prefetched: boolean;
  }
): Promise<PuzzleSessionRecord> {
  const result = await pool.query(
    `UPDATE puzzle_sessions
     SET prefetched = $2,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [input.sessionId, input.prefetched]
  );

  return mapSession(result.rows[0] as Record<string, unknown>);
}

export async function getOldestPrefetchedPuzzleSession(
  pool: Pool,
  anonSessionId: string,
  mode: VariationMode,
  excludeSessionId?: string
): Promise<PuzzleSessionRecord | null> {
  const baseQuery = `SELECT *
     FROM puzzle_sessions ps
     WHERE ps.anon_session_id = $1
       AND ps.mode = $2
       AND ps.prefetched = true`;

  const withExcludeQuery = `${baseQuery}
       AND ps.id <> $3
     ORDER BY ps.created_at ASC
     LIMIT 1`;

  const withoutExcludeQuery = `${baseQuery}
     ORDER BY ps.created_at ASC
     LIMIT 1`;

  const result = excludeSessionId
    ? await pool.query(withExcludeQuery, [anonSessionId, mode, excludeSessionId])
    : await pool.query(withoutExcludeQuery, [anonSessionId, mode]);

  return result.rowCount ? mapSession(result.rows[0] as Record<string, unknown>) : null;
}

export async function listPuzzleSessionHistory(
  pool: Pool,
  anonSessionId: string,
  limit: number,
  excludeSessionId?: string
): Promise<PuzzleSessionHistoryRecord[]> {
  // Excludes synthetic "started from history" rows unless there is user activity worth surfacing.
  const baseQuery = `SELECT
      ps.id AS session_id,
      p.public_id AS puzzle_public_id,
      p.title AS puzzle_title,
      ps.created_at AS created_at,
      ps.solved AS solved,
      ps.revealed AS revealed,
      ps.autoplay_used AS autoplay_used,
      ps.wrong_move_count AS wrong_move_count,
      ps.hint_count AS hint_count
     FROM puzzle_sessions ps
     INNER JOIN puzzles p ON p.id = ps.puzzle_id
     WHERE ps.anon_session_id = $1
       AND ps.prefetched = false
       AND (
         ps.started_from_history = false
         OR ps.solved = true
         OR ps.revealed = true
         OR ps.wrong_move_count > 0
         OR ps.hint_count > 0
         OR ps.autoplay_used = true
       )`;

  const withExcludeQuery = `${baseQuery}
       AND ps.id <> $3
     ORDER BY ps.created_at DESC
     LIMIT $2`;

  const withoutExcludeQuery = `${baseQuery}
     ORDER BY ps.created_at DESC
     LIMIT $2`;

  const result = excludeSessionId
    ? await pool.query(withExcludeQuery, [anonSessionId, limit, excludeSessionId])
    : await pool.query(withoutExcludeQuery, [anonSessionId, limit]);

  return result.rows.map((row) => mapHistory(row as Record<string, unknown>));
}

export async function clearPuzzleSessionHistory(
  pool: Pool,
  anonSessionId: string,
  keepSessionId: string
): Promise<number> {
  const result = await pool.query(
    `DELETE FROM puzzle_sessions
     WHERE anon_session_id = $1
       AND id <> $2`,
    [anonSessionId, keepSessionId]
  );

  return result.rowCount ?? 0;
}
