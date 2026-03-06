import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const envFileDir = dirname(fileURLToPath(import.meta.url));

// Prefer repo-root env file for workspace commands.
loadDotenv({ path: resolve(envFileDir, '../../../../.env') });
// Allow overriding from current working directory.
loadDotenv({ path: resolve(process.cwd(), '.env'), override: true });
