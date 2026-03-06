import './loadEnv.js';
import { z } from 'zod';
import { createDbPool, runMigrations } from '@chess-web/db';

const schema = z.object({
  DATABASE_URL: z.string().min(1)
});

async function main(): Promise<void> {
  const env = schema.parse(process.env);
  const pool = createDbPool(env.DATABASE_URL);
  try {
    await runMigrations(pool);
    console.log('Migrations completed');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
