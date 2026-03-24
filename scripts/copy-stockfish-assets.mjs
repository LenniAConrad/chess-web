#!/usr/bin/env node

import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const webPackageRequire = createRequire(path.join(repoRoot, 'apps/web/package.json'));
const stockfishPackageJson = webPackageRequire.resolve('stockfish/package.json');
const stockfishRoot = path.dirname(stockfishPackageJson);
const sourceDir = path.join(stockfishRoot, 'src');
const targetDir = path.join(repoRoot, 'apps/web/public/vendor/stockfish');

const files = ['stockfish-nnue-16-single.js', 'stockfish-nnue-16-single.wasm'];

await mkdir(targetDir, { recursive: true });

for (const file of files) {
  await copyFile(path.join(sourceDir, file), path.join(targetDir, file));
}

console.log(`Copied ${files.length} Stockfish assets to ${targetDir}`);
