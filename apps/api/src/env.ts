import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from '@chess-web/config';
import { z } from 'zod';

const envFileDir = dirname(fileURLToPath(import.meta.url));

// Always try repo-root .env first so `pnpm --filter ...` works from any cwd.
loadDotenv({ path: resolve(envFileDir, '../../../.env') });
// Fallback to cwd .env for alternative launch setups.
loadDotenv({ path: resolve(process.cwd(), '.env') });

export const env = parseEnv(
  {
    API_PORT: z.coerce.number().int().positive().default(3001),
    API_HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z.string().min(1).default('pgmem://local'),
    COOKIE_SECRET: z.string().min(32),
    ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
    IMPORT_TOKEN: z.string().min(16),
    SEED_PGN_FILE: z.string().optional(),
    SEED_MAX_PUZZLES: z.coerce.number().int().positive().default(200)
  },
  process.env
);
