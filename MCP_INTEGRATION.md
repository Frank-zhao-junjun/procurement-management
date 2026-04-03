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

### 1. MCP 鉴权加固

| 检查项 | 状态 | 说明 |
|--------|------|------|
| Agent 身份验证 | ❌ 待实现 | 需要验证调用者是否为已注册的 Agent |
| API Key 认证 | ❌ 待实现 | 可选：基于 Bearer Token 的认证 |
| 请求频率限制 | ❌ 待实现 | 防止滥用 |
| 操作审计日志 | ❌ 待实现 | 记录所有 MCP 调用 |

#### 推荐实现方案

```typescript
// src/mcp/auth.ts

// Agent 注册表 (可存储在数据库或内存中)
const registeredAgents = new Map<string, { role: string; permissions: string[] }>();

// 鉴权中间件
async function authenticateAgent(req: Request): Promise<{ agentId: string; role: string } | null> {
  const apiKey = req.headers.get('Authorization')?.replace('Bearer ', '');
  
  if (!apiKey) {
    return null;
  }
  
  // 从数据库验证 API Key
  const agent = await db.query('SELECT * FROM agent_api_keys WHERE api_key = $1', [apiKey]);
  
  if (!agent) {
    return null;
  }
  
  return { agentId: agent.agent_id, role: agent.role };
}

// 工具权限检查
function checkToolPermission(role: string, toolName: string): boolean {
  const permissions = {
    requester: ['match_material', 'list_materials', 'create_material', 'list_suppliers', 
                 'create_purchase_request', 'list_purchase_requests', 'submit_purchase_request',
                 'list_purchase_orders', 'list_goods_receipts'],
    buyer: ['*'], // 所有工具
    manager: ['*'], // 所有工具
  };
  
  const rolePerms = permissions[role as keyof typeof permissions] || [];
  return rolePerms.includes('*') || rolePerms.includes(toolName);
}
```

### 2. 同域反代配置

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 与主服务同域部署 | ❌ 待实现 | 需要集成到 Next.js 或统一入口 |
| Nginx 反向代理 | ❌ 待规划 | 可选方案 |
| 统一 CORS 配置 | ❌ 待实现 | 需要处理跨域问题 |

#### 方案 A: 集成到 Next.js (推荐)

```typescript
// src/app/api/mcp/route.ts (App Router)
import { NextRequest, NextResponse } from 'next/server';
import { mcpHandler } from '@/lib/mcp-handler';

export async function POST(request: NextRequest) {
  const response = await mcpHandler(request, 'stream');
  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }
  
  const response = await mcpHandler(request, 'sse', sessionId);
  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
```

#### 方案 B: Nginx 反向代理

```nginx
# /etc/nginx/conf.d/purchase.coze.site.conf

server {
    listen 80;
    server_name purchase.coze.site;

    # 主应用
    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # MCP Server 反代
    location /mcp/ {
        proxy_pass http://localhost:5001/mcp/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $http_connection;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        
        # SSE 支持
        proxy_cache off;
        proxy_buffering off;
    }
}
```

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
- [ ] MCP Server 集成到 Next.js 统一入口 (避免跨域问题)
- [ ] 实现 Agent 鉴权机制
- [ ] 添加 MCP 调用审计日志

### 中优先级
- [ ] 实现请求频率限制
- [ ] 添加健康检查端点
- [ ] 完善错误处理和日志

### 低优先级
- [ ] 添加 MCP 监控指标
- [ ] 实现会话超时管理
- [ ] 添加重试机制
