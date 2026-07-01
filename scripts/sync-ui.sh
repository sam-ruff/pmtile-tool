#!/usr/bin/env bash
# Build the frontend and copy it into static/ for build.rs to embed.
set -euo pipefail
cd "$(dirname "$0")/.."

(cd frontend && pnpm install --frozen-lockfile && pnpm run build)

rm -rf static
mkdir -p static
cp -r frontend/dist/. static/
touch static/.gitkeep
echo "synced frontend/dist -> static/ ($(find static -type f | wc -l) files)"
