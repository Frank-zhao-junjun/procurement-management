#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"

cd "${COZE_WORKSPACE_PATH}"

echo "Building MCP Server..."
pnpm tsup src/mcp/server.ts --format cjs --platform node --target node20 --outDir dist/mcp --no-splitting --no-minify

echo "MCP Server build complete"
