import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const dirnameSelf = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node'
  },
  resolve: {
    alias: {
      '@chess-web/chess-core': resolve(dirnameSelf, '../../packages/chess-core/src/index.ts'),
      '@chess-web/config': resolve(dirnameSelf, '../../packages/config/src/index.ts'),
      '@chess-web/db': resolve(dirnameSelf, '../../packages/db/src/index.ts')
    }
  }
});
