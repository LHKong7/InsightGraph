#!/usr/bin/env bash
# Start the InsightGraph MCP server with hot reload.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."

cd "$ROOT_DIR"

pnpm --filter @insightgraph/mcp-server run dev
