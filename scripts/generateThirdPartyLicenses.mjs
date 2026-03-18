import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const RETAINED_LICENSES = ['Apache-2.0', 'GPL-3.0-or-later', 'GPL'];

const raw = execSync('npx pnpm@10.5.2 licenses list --prod --json', {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
});

const parsed = JSON.parse(raw);
const filtered = {};

for (const license of RETAINED_LICENSES) {
  const packages = parsed[license];

  if (!Array.isArray(packages) || packages.length === 0) {
    continue;
  }

  filtered[license] = packages
    .map((pkg) => {
      if (pkg && typeof pkg === 'object') {
        const nextPkg = { ...pkg };
        delete nextPkg.paths;
        delete nextPkg.path;
        return nextPkg;
      }

      return pkg;
    })
    .sort((left, right) => {
      if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
        return 0;
      }

      return String(left.name).localeCompare(String(right.name));
    });
}

writeFileSync('THIRD_PARTY_LICENSES.json', `${JSON.stringify(filtered, null, 2)}\n`, 'utf8');
