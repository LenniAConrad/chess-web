import type { Pool } from 'pg';

export type RateAction = 'allow' | 'throttle' | 'ban';

export async function recordRateLimitEvent(
  pool: Pool,
  input: { ipHash: string; anonSessionId?: string; route: string; action: RateAction }
): Promise<void> {
  await pool.query(
    `INSERT INTO rate_limit_events(ip_hash, anon_session_id, route, action)
     VALUES ($1, $2, $3, $4)`,
    [input.ipHash, input.anonSessionId ?? null, input.route, input.action]
  );
}
