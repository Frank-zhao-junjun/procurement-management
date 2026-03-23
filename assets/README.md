# 采购管理系统 (Procurement Management System)

面向 Agent 使用的采购管理系统，支持采购申请、寻源、报价、框架协议、采购订单、收货等全流程管理。
系统采用 **Agent-first 身份模型**：`agent_id + role`，简洁直接。

## 功能特性

- **采购申请 (PR)**: 创建、提交、审批
- **寻源任务 (SC)**: 供应商寻源管理
- **报价单 (Q)**: 单一中标报价管理
- **框架协议 (FA)**: 价格协议管理，支持自动匹配
- **采购订单 (PO)**: 订单创建、发送、状态跟踪
- **收货单 (GR/RT)**: 收货与退货管理，含超收审批
- **审计日志**: 完整操作追溯

## 技术栈

- **框架**: Next.js 16 (App Router)
- **UI**: React 19 + shadcn/ui + Tailwind CSS 4
- **数据库**: PostgreSQL (Supabase)
- **语言**: TypeScript 5
- **包管理**: pnpm

## 快速开始

### 安装依赖

```bash
pnpm install
```

### 开发环境

```bash
pnpm dev
```

访问 [http://localhost:5000](http://localhost:5000)

### 生产构建

```bash
pnpm build
pnpm start
```

## API 调用示例

Agent 可通过 HTTP API 调用系统：

```bash
# 注册 Agent（首次使用前）
curl -X POST http://localhost:5000/api/agent-bindings \
  -H "Content-Type: application/json" \
  -d '{"agentId":"coze_bot_001","role":"requester"}'

# 注册 Manager Agent（带 webhook，接收待审批通知）
curl -X POST http://localhost:5000/api/agent-bindings \
  -H "Content-Type: application/json" \
  -d '{"agentId":"coze_manager_001","role":"manager","webhookUrl":"https://example.com/webhook"}'

# 创建采购申请
curl -X POST http://localhost:5000/api/purchase-requests \
  -H "Content-Type: application/json" \
  -H "X-Actor: coze_bot_001" \
  -d '{"reason":"产线急需M3螺栓500个","lines":[{"requirementText":"M3螺栓","quantity":500}]}'

# 提交采购申请
curl -X POST http://localhost:5000/api/purchase-requests/{id}/submit \
  -H "X-Actor: coze_bot_001"

# 审批采购申请
curl -X POST http://localhost:5000/api/purchase-requests/{id}/approve \
  -H "Content-Type: application/json" \
  -H "X-Actor: coze_manager_001" \
  -d '{"approved": true}'
```

## Agent-first 模型

```
一个 Agent ↔ 一个角色
```

- **Agent 优先**：每个 Agent 有唯一 `agent_id` 和固定 `role`
- **角色固定**：`requester` / `buyer` / `manager`
- **Webhook 通知**：Manager Agent 可配置 `webhookUrl` 接收待审批事件

## 角色权限

| 角色 | 说明 |
|------|------|
| `requester` | 需求人，可创建采购申请、收货 |
| `buyer` | 采购人，可创建 PO、报价、寻源任务 |
| `manager` | 审批人，可审批 PR 和超收收货 |

## Web 端身份切换（调试/演示）

- Web 端内置身份选择器，可在页面右上角切换 `requester/buyer/manager`
- 可自定义 Actor（例如 `coze_bot_001`）模拟不同 Agent
- 前端请求会自动附带 `X-Actor` 和 `X-Role` 请求头

## Webhook 事件通知

Manager Agent 可通过 `webhookUrl` 接收系统事件通知：

- `pr_submitted`: 采购申请提交后触发
- `overdelivery_pending`: 超收待审批时触发

说明：
- 仅会通知角色为 `manager` 且已配置 `webhook_url` 的 Agent
- 通知以 HTTP POST 发送，超时 10 秒，失败不阻塞主业务流程

## 已知兼容性说明（PostgREST schema cache）

为避免 Supabase/PostgREST 关系缓存异常导致的查询失败，
以下列表接口已改为主表查询（`select('*')`），通过快照字段存储关联数据：

- `/api/framework-agreements`
- `/api/sourcing-tasks`
- `/api/quotes`
- `/api/goods-receipts`

## 项目结构

```
src/
├── app/
│   ├── api/                  # API 路由
│   │   ├── materials/
│   │   ├── suppliers/
│   │   ├── purchase-requests/
│   │   ├── purchase-orders/
│   │   ├── goods-receipts/
│   │   ├── framework-agreements/
│   │   ├── sourcing-tasks/
│   │   ├── quotes/
│   │   └── audit-logs/
│   └── ...                   # 页面路由
├── components/
│   └── ui/                   # shadcn/ui 组件
├── lib/
│   ├── api.ts                # API 客户端
│   └── role-filter.ts        # 角色权限过滤
└── storage/
    └── database/
        ├── schema.ts         # 数据库 Schema
        ├── number-generator.ts    # 单据编号生成
        ├── fa-matcher.ts         # FA 智能匹配
        ├── po-sender.ts          # PO 发送与重试
        └── agent-binding.ts      # Agent 注册与 webhook 获取
```

## 数据库

系统使用 Supabase (PostgreSQL)，包含以下核心表：

- `materials` - 物料主数据
- `suppliers` - 供应商主数据
- `purchase_requests` - 采购申请
- `purchase_request_lines` - 采购申请行
- `sourcing_tasks` - 寻源任务
- `quotes` - 报价单
- `framework_agreements` - 框架协议
- `purchase_orders` - 采购订单
- `purchase_order_lines` - 采购订单行
- `goods_receipts` - 收货单
- `audit_logs` - 审计日志
- `agent_bindings` - Agent 注册（agent_id + role + webhook_url）
- `po_send_failures` - PO 发送失败记录

## License

MIT
