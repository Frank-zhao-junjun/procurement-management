# MCP Server 联调与加固清单

## 现状分析

### 当前架构
```
┌─────────────────────────────────────────────────────────────┐
│                     Next.js App (Port 5000)                │
│  ┌─────────────────┐  ┌─────────────────────────────────┐ │
│  │  /api/* Routes  │  │     /mcp/* Routes (Future)      │ │
│  └─────────────────┘  └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│                   MCP Server (Port 5001)                    │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  18 Tools: 物料/供应商/PR/寻源/报价/PO/收货/FA           ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 当前 MCP Server 配置
- **运行端口**: 5001
- **端点**: `/mcp`
- **传输协议**: Streamable HTTP
- **启动命令**: `pnpm start:mcp`

---

## 检查清单

### 1. MCP 鉴权（已实现）

| 检查项 | 状态 | 说明 |
|--------|------|------|
| Agent 身份验证 | ✅ | Bearer Token 内嵌 `agent_id`，服务端用 `MCP_API_KEY_SECRET` 校验 HMAC；**角色以 `agent_bindings` 为准**（查库），不新表 |
| Bearer Token | ✅ | 格式 `v1.<base64url(payload)>.<hex_hmac>`，`payload = { a, exp }` |
| 请求频率限制 | ❌ | 待实现（建议网关或后续中间件） |
| 操作审计日志 | ✅ | `audit_logs`：`entity_type=mcp`，`action=mcp_tool_ok` / `mcp_tool_error` |

**生成 Token（与 `src/mcp/auth.ts` 一致）：**

```bash
# 需与线上相同的 MCP_API_KEY_SECRET；agent_id 须已在 agent_bindings 中注册
pnpm mcp:token <agent_id> 86400
```

**环境变量：**

- `MCP_API_KEY_SECRET`：签发/校验密钥。**生产环境必填**；未配置时开发环境使用占位身份 `mcp-dev`（仅本地）。
- `COZE_SUPABASE_SERVICE_ROLE_KEY`：MCP 进程查询 `agent_bindings`、写 `audit_logs` 建议使用（与主应用一致）。

实现文件：`src/mcp/auth.ts`、`src/mcp/tool-policy.ts`、`src/mcp/audit.ts`、`src/mcp/context.ts`。

### 2. 同域反代（方案 B：Nginx）

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 与主服务同域 | ✅ 文档级 | 浏览器/Coze 只访问 `https://purchase.coze.site`，由 Nginx 分流 |
| Nginx 反向代理 | ✅ | 见下（**须透传 `Authorization` 与 `mcp-session-id`**） |
| CORS | ✅ | MCP 进程已允许 `Authorization` 请求头 |

#### Nginx 反向代理（方案 B）

```nginx
# /etc/nginx/conf.d/purchase.coze.site.conf

server {
    listen 443 ssl;
    server_name purchase.coze.site;

    # 主应用
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # MCP：同域 https://purchase.coze.site/mcp/ → 本机 MCP 端口
    location /mcp/ {
        proxy_pass http://127.0.0.1:5001/mcp/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $http_connection;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 鉴权与会话：必须转发客户端原始头
        proxy_set_header Authorization $http_authorization;
        proxy_set_header mcp-session-id $http_mcp_session_id;

        proxy_cache off;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

**Coze 侧填写的 MCP 地址示例：** `https://purchase.coze.site/mcp`（以实际 TLS 与路径为准）。

#### 方案 A: 集成到 Next.js（可选，后续）

仍可将 Streamable HTTP 挂到 `/api/mcp`；当前以 **独立进程 + Nginx 反代** 为默认，运维简单、与现有 `start-all.sh` 一致。

### 3. 环境变量配置

需要新增以下环境变量到 `.env.example` 和生产环境：

```bash
# MCP Server 配置
MCP_SERVER_PORT=5001
MCP_SERVER_HOST=0.0.0.0
MCP_SERVER_ENABLED=true

# MCP 鉴权 (可选)
MCP_API_KEY_SECRET=your-secret-key
MCP_REQUIRE_AUTH=true

# 反代配置
MCP_PROXY_PATH=/mcp
```

### 4. 一键启动脚本

```bash
# scripts/start-all.sh
#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"
PORT="${DEPLOY_RUN_PORT:-5000}"

cd "${COZE_WORKSPACE_PATH}"

# 启动 MCP Server (后台)
echo "Starting MCP Server..."
MCP_SERVER_PORT=5001 node dist/mcp/server.js &
MCP_PID=$!

# 启动主服务
echo "Starting Main Server..."
PORT=$PORT node dist/server.js &
MAIN_PID=$!

# 等待任一服务退出
trap "kill $MCP_PID $MAIN_PID 2>/dev/null" EXIT
wait
```

---

## 联调测试用例

### 1. 基础连接测试

```bash
# 测试 MCP Server 健康检查
curl -I http://localhost:5001/health

# 测试初始化
curl -X POST http://localhost:5001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

### 2. 工具调用测试

```bash
# 1. 初始化并获取 sessionId
SESSION=$(curl -s -D - -X POST http://localhost:5001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | grep -i "mcp-session-id" | awk '{print $2}' | tr -d '\r')

# 2. 发送 initialized 通知
curl -s -X POST http://localhost:5001/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}'

# 3. 调用工具
curl -s -X POST http://localhost:5001/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"match_material","arguments":{"text":"无线鼠标"}}}'
```

### 3. 鉴权测试

```bash
# 无鉴权测试
curl -X POST http://localhost:5001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_materials","arguments":{}}}'

# 带 API Key 测试 (实现后)
curl -X POST http://localhost:5001/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-api-key>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_materials","arguments":{}}}'
```

---

## 待办事项

### 高优先级
- [ ] MCP Server 集成到 Next.js 统一入口 (可选；当前以 Nginx 同域反代为主)
- [x] Agent 鉴权机制（Bearer + agent_bindings，见上文）
- [x] MCP 调用审计日志（audit_logs / entity_type=mcp）

### 中优先级
- [ ] 实现请求频率限制
- [ ] 添加健康检查端点
- [ ] 完善错误处理和日志

### 低优先级
- [ ] 添加 MCP 监控指标
- [ ] 实现会话超时管理
- [ ] 添加重试机制
