#!/usr/bin/env bash
# Start the Next.js web frontend on port 3000.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."

cd "$ROOT_DIR/web"

if [ ! -d "node_modules" ]; then
  echo "Installing web dependencies..."
  pnpm install
fi

echo "Starting web frontend on http://localhost:3000 ..."
pnpm run dev
