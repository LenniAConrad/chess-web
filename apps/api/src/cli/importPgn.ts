import './loadEnv.js';
import { createDbPool, runMigrations } from '@chess-web/db';
import { z } from 'zod';
import { importPgnFile } from '../services/pgnImport.js';

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

  const result = await importPgnFile(pool, args.file);
  console.log(`Import completed. success=${result.success} failed=${result.failed}`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
