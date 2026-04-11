#!/usr/bin/env bash
# Install dependencies and build all packages and apps.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."

cd "$ROOT_DIR"

echo "Installing dependencies..."
pnpm install

echo "Building all packages and apps..."
pnpm run build

echo "Build complete."
