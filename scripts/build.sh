#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"

cd "${COZE_WORKSPACE_PATH}"

echo "Installing dependencies..."
pnpm install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only

echo "Building the Next.js project..."
pnpm next build

echo "Bundling server with tsup..."
pnpm tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify

echo "Bundling MCP server..."
pnpm tsx -e "
const { build } = require('esbuild');
build({
  entryPoints: ['src/mcp/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/mcp/server.js',
  format: 'cjs',
  packages: 'external',
}).catch(() => process.exit(1));
"

echo "Build completed successfully!"
