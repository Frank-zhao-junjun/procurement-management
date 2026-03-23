# 采购管理系统 (Procurement Management System)

面向 Agent 使用的全流程采购管理系统，支持采购申请、寻源、报价、框架协议、采购订单、收货等核心功能。
系统采用 **Agent-first 身份模型**：`agent_id + role`，简洁直接。

## 技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **Database**: Supabase (PostgreSQL)
- **UI**: shadcn/ui
- **Styling**: Tailwind CSS 4

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
# 编辑 .env.local 填入你的 Supabase 配置
```

### 3. 启动开发服务器

```bash
pnpm dev
```

访问 http://localhost:5000

## Agent 使用

详细指南请查看 [AGENTS.md](AGENTS.md)

```bash
# 注册 Agent
POST /api/agent-bindings
{"agentId": "my-agent", "role": "buyer"}

# 注册 Manager Agent（带 Webhook 接收通知）
POST /api/agent-bindings
{"agentId": "my-manager", "role": "manager", "webhookUrl": "https://example.com/webhook"}

# 创建采购申请
POST /api/purchase-requests
-H "X-Actor: my-agent"
{"reason": "采购M3螺栓", "lines": [...]}
```

## 核心功能

- **采购申请 (PR)** - 创建、提交、审批
- **框架协议 (FA)** - 自动匹配、手动确认
- **寻源任务 (SC)** - 供应商询价
- **报价单 (Quote)** - 多供应商竞价
- **采购订单 (PO)** - 生成、发送、重试
- **收货单 (GR)** - 标准收货、超收审批、退货
- **审计日志** - 全操作记录

## Agent-first 模型

```
一个 Agent ↔ 一个角色
```

- **Agent 优先**：每个 Agent 有唯一 `agent_id` 和固定 `role`
- **角色固定**：`requester` / `buyer` / `manager`
- **Webhook 通知**：Manager Agent 可配置 `webhookUrl` 接收待审批事件

## Webhook 事件通知

Manager Agent 可通过 `webhookUrl` 接收系统事件通知：

| 事件 | 触发时机 |
|------|----------|
| `pr_submitted` | 采购申请提交后 |
| `overdelivery_pending` | 超收待审批时 |

## 角色权限

| 角色 | 可创建 | 可查看 | 可审批 |
|------|--------|--------|--------|
| `requester` | PR | 自己PR对应数据 | - |
| `buyer` | PO, Quote, SC, FA | 所有采购数据 | - |
| `manager` | - | 所有数据 | PR, 超收收货 |

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

| 表名 | 说明 |
|------|------|
| `materials` | 物料主数据 |
| `suppliers` | 供应商主数据 |
| `purchase_requests` | 采购申请 |
| `purchase_request_lines` | 采购申请行 |
| `sourcing_tasks` | 寻源任务 |
| `quotes` | 报价单 |
| `framework_agreements` | 框架协议 |
| `purchase_orders` | 采购订单 |
| `purchase_order_lines` | 采购订单行 |
| `goods_receipts` | 收货单 |
| `audit_logs` | 审计日志 |
| `agent_bindings` | Agent 注册（agent_id + role + webhook_url） |
| `po_send_failures` | PO 发送失败记录 |

## 文档

- [Agent 使用指南](AGENTS.md)
- [Agent 绑定实现](docs/AGENT_BINDING.md)
- [待完成设计](DESIGN_PENDING.md)
- [贡献指南](CONTRIBUTING.md)

## License

MIT
