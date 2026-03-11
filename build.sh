#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PNPM_CMD=(npx pnpm@10.5.2)

echo "Installing dependencies (frozen lockfile)..."
"${PNPM_CMD[@]}" install --frozen-lockfile

echo "Running typecheck..."
"${PNPM_CMD[@]}" -r typecheck

echo "Running lint..."
"${PNPM_CMD[@]}" -r lint

echo "Running tests..."
"${PNPM_CMD[@]}" -r test

echo "Building all workspace packages..."
"${PNPM_CMD[@]}" -r build

echo "Refreshing THIRD_PARTY_LICENSES.json..."
node scripts/generateThirdPartyLicenses.mjs

echo "Build completed successfully."
