import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (key?.startsWith('--') && value) {
    args.set(key, value);
    index += 1;
  }
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function resolveCliPath(flagValue, defaultRelativePath) {
  if (typeof flagValue === 'string' && flagValue.length > 0) {
    return resolve(process.cwd(), flagValue);
  }

  return resolve(repoRoot, defaultRelativePath);
}

const sourceFile = resolveCliPath(args.get('--source'), 'puzzle_exports/stack_min_2plies_256k.pgn');
const outDir = resolveCliPath(args.get('--out'), 'apps/web/dist/offline');
const outPgnFile = resolve(outDir, 'puzzles.pgn');
const outIndexFile = resolve(outDir, 'index.json');
const marker = Buffer.from('[SetUp "1"]', 'utf8');
const sourceBuffer = readFileSync(sourceFile);
const offsets = [];

for (let cursor = 0; cursor < sourceBuffer.length; ) {
  const next = sourceBuffer.indexOf(marker, cursor);
  if (next === -1) {
    break;
  }

  offsets.push(next);
  cursor = next + marker.length;
}

if (offsets.length === 0) {
  throw new Error(`No puzzle blocks found in ${sourceFile}`);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(dirname(outPgnFile), { recursive: true });
writeFileSync(outPgnFile, sourceBuffer);
writeFileSync(
  outIndexFile,
  JSON.stringify({
    version: 1,
    count: offsets.length,
    totalBytes: sourceBuffer.length,
    offsets
  })
);

console.log(`Bundled ${offsets.length} offline puzzles into ${outDir}`);
