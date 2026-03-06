import './loadEnv.js';
import { z } from 'zod';
import { createDbPool } from '@chess-web/db';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1)
});

const argsSchema = z.object({
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
});

function parseArgs(argv: string[]): { day?: string } {
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

  return argsSchema.parse({ day: map.get('day') });
}

async function main(): Promise<void> {
  const env = envSchema.parse(process.env);
  const args = parseArgs(process.argv.slice(2));

  const pool = createDbPool(env.DATABASE_URL);

  try {
    const targetDay = args.day ?? new Date().toISOString().slice(0, 10);

    const dauResult = await pool.query(
      `SELECT COUNT(DISTINCT anon_session_id)::int AS dau
       FROM puzzle_sessions
       WHERE created_at::date = $1::date`,
      [targetDay]
    );

    const sessionResult = await pool.query(
      `SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at))), 0)::int AS avg_session_seconds
       FROM puzzle_sessions
       WHERE created_at::date = $1::date`,
      [targetDay]
    );

    const dau = Number(dauResult.rows[0]?.dau ?? 0);
    const avgSessionSeconds = Number(sessionResult.rows[0]?.avg_session_seconds ?? 0);

    await pool.query(
      `INSERT INTO daily_metrics(day, dau, avg_session_seconds)
       VALUES ($1::date, $2, $3)
       ON CONFLICT(day)
       DO UPDATE SET dau = EXCLUDED.dau,
                     avg_session_seconds = EXCLUDED.avg_session_seconds`,
      [targetDay, dau, avgSessionSeconds]
    );
    console.log(`Daily metrics aggregated for ${targetDay}: dau=${dau}, avg_session_seconds=${avgSessionSeconds}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
