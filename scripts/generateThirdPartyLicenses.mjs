import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const raw = execSync('npx pnpm@10.5.2 licenses list --json', {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
});

const parsed = JSON.parse(raw);

for (const packages of Object.values(parsed)) {
  if (!Array.isArray(packages)) {
    continue;
  }

  for (const pkg of packages) {
    if (pkg && typeof pkg === 'object') {
      delete pkg.paths;
      delete pkg.path;
    }
  }
}

writeFileSync('THIRD_PARTY_LICENSES.json', `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
