import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

const dirnameSelf = dirname(fileURLToPath(import.meta.url));

async function resolveMigrationsDir(): Promise<string> {
  const candidates = [
    join(dirnameSelf, 'migrations'),
    join(dirnameSelf, '../src/migrations'),
    resolve(process.cwd(), 'packages/db/dist/migrations'),
    resolve(process.cwd(), 'packages/db/src/migrations'),
    resolve(process.cwd(), 'apps/api/dist/packages/db/src/migrations')
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try the next known layout
    }
  }

  throw new Error(`Unable to locate SQL migrations. Checked: ${candidates.join(', ')}`);
}

export async function runMigrations(pool: Pool): Promise<void> {
  const migrationsDir = await resolveMigrationsDir();
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id bigserial PRIMARY KEY,
      name text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    )`
  );

  await pool.query('BEGIN');
  try {
    for (const file of files) {
      const { rowCount } = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (rowCount && rowCount > 0) {
        continue;
      }

      const sql = await readFile(join(migrationsDir, file), 'utf-8');
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
    }
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}
