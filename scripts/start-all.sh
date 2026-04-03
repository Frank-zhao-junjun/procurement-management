#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"
PORT="${DEPLOY_RUN_PORT:-5000}"
MCP_PORT="${MCP_SERVER_PORT:-5001}"

cd "${COZE_WORKSPACE_PATH}"

echo "=========================================="
echo "  Procurement Management System"
echo "  - Main Server: http://localhost:${PORT}"
echo "  - MCP Server: http://localhost:${MCP_PORT}/mcp"
echo "=========================================="

# 启动 MCP Server (后台)
echo "[1/2] Starting MCP Server on port ${MCP_PORT}..."
MCP_SERVER_PORT=${MCP_PORT} node dist/mcp/server.js > /app/work/logs/bypass/mcp.log 2>&1 &
MCP_PID=$!
echo "      MCP Server PID: ${MCP_PID}"

# 等待 MCP Server 启动
sleep 2

# 检查 MCP Server 是否启动成功
if ! ss -H -lntp 2>/dev/null | grep -q ":${MCP_PORT}"; then
    echo "      WARNING: MCP Server may not have started correctly"
    echo "      Check logs: /app/work/logs/bypass/mcp.log"
fi

# 启动主服务
echo "[2/2] Starting Main Server on port ${PORT}..."
PORT=${PORT} node dist/server.js > /app/work/logs/bypass/app.log 2>&1 &
MAIN_PID=$!
echo "      Main Server PID: ${MAIN_PID}"

echo ""
echo "All services started!"
echo ""

# 等待任一服务退出
trap "echo 'Shutting down...'; kill ${MCP_PID} ${MAIN_PID} 2>/dev/null; exit 0" EXIT INT TERM

echo "Press Ctrl+C to stop all services"
wait
