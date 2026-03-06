import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { DataType, newDb } from 'pg-mem';

let inMemoryPool: Pool | null = null;

function createInMemoryPool(): Pool {
  if (inMemoryPool) {
    return inMemoryPool;
  }

  const db = newDb({
    autoCreateForeignKeyIndices: true,
    noAstCoverageCheck: true
  });

  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    implementation: () => randomUUID()
  });

  const adapter = db.adapters.createPg();
  inMemoryPool = new adapter.Pool() as unknown as Pool;
  return inMemoryPool;
}

export function createDbPool(connectionString: string): Pool {
  if (connectionString.startsWith('pgmem://')) {
    return createInMemoryPool();
  }

  return new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });
}
