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
- **报价单 (Quote)** - 多供应商竞价、授标自动创建 PO
- **采购订单 (PO)** - 生成、发送、重试
- **收货单 (GR)** - 标准收货、超收审批、退货
- **审计日志** - 全操作记录（含 system 角色）
- **Dashboard** - 实时统计概览

## 功能特性

### 搜索与筛选

- **物料/供应商搜索** - 支持按名称、编码、联系人模糊搜索
- **PO 状态筛选** - 按草稿/已发送/部分收货/已收货/已取消筛选
- **PR 状态筛选** - 按草稿/待审批/已审批/已拒绝筛选

### Dashboard 统计

实时显示关键业务指标：
- PR 总数及待审批数量
- PO 总数及待发货数量
- 供应商总数
- 物料总数

## Agent-first 模型

```
一个 Agent ↔ 一个角色
```

- **Agent 优先**：每个 Agent 有唯一 `agent_id` 和固定 `role`
- **角色类型**：
  - `requester` - 需求人
  - `buyer` - 采购员
  - `manager` - 审批人/经理
  - `system` - 系统操作（审计日志专用）
- **Webhook 通知**：各角色可配置 `webhookUrl` 接收业务事件（唯一主通道）

## 通知能力说明

### Webhook 通知（主要方式）

Manager Agent 可通过 `webhookUrl` 接收系统事件通知，**在 Coze 沙箱环境中可用**。

#### 统一 Payload 格式

所有 Webhook 事件使用统一的 JSON 格式：

```json
{
  "schema_version": "1.0",
  "event": "event_type",
  "event_id": "uuid-v4",
  "timestamp": "2024-03-29T10:30:00+08:00",
  "data": {
    "entity_type": "purchase_request",
    "entity_id": 123,
    ...event_specific_fields
  }
}
```

#### 事件列表

| 事件 | 触发时机 | 通知目标 |
|------|----------|----------|
| `pr_submitted` | 采购申请提交后 | Manager |
| `pr_approved` | 采购申请审批通过 | Manager（摘要）、Requester（详情） |
| `pr_rejected` | 采购申请审批拒绝 | Manager（摘要）、Requester（详情） |
| `pr_processing_task` | PR 审批后产生 PO/寻源任务 | Buyer |
| `po_created` | 手工创建采购订单后 | Buyer |
| `contract_pending` | 框架协议提交待审批后 | Manager |
| `overdelivery_pending` | 超收待审批时 | Manager |
| `overdelivery_approved` | 超收审批通过 | 需求方 |

#### PR 审批通过后 Payload 示例

```json
{
  "schema_version": "1.0",
  "event": "pr_processing_task",
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2024-03-29T10:30:00+08:00",
  "data": {
    "entity_type": "purchase_request",
    "entity_id": 123,
    "pr_id": 123,
    "pr_number": "PR-20240329-01",
    "created_pos": [
      {"po_id": 456, "po_number": "PO-20240329-01", "supplier_name": "XXX 供应商"}
    ],
    "sourcing_tasks": [
      {"task_id": 789, "task_number": "SC-20240329-01", "material_snapshot": "无线鼠标"}
    ]
  }
}
```

#### 超收待审批 Payload 示例

```json
{
  "schema_version": "1.0",
  "event": "overdelivery_pending",
  "event_id": "550e8400-e29b-41d4-a716-446655440001",
  "timestamp": "2024-03-29T10:30:00+08:00",
  "data": {
    "entity_type": "goods_receipt",
    "entity_id": 10,
    "gr_id": 10,
    "gr_number": "GR-20240329-01",
    "po_id": 5,
    "po_line_id": 8,
    "order_qty": 100,
    "gr_quantity": 110,
    "overdelivery_ratio": 0.1,
    "requested_by": "buyer-agent",
    "requested_at": "2024-03-29T10:30:00+08:00",
    "notes": "供应商多送了10个"
  }
}
```

#### 安全特性

- **幂等**：每个事件带有唯一 `event_id`，接收方可据此去重
- **签名**：可选 `X-Webhook-Signature` 头（HMAC-SHA256），密钥通过 `WEBHOOK_SECRET` 环境变量配置
- **重试**：失败自动重试最多 3 次
- **审计**：所有发送记录存入 `webhook_logs` 表

## 角色权限

| 角色 | 可创建 | 可查看 | 可审批 |
|------|--------|--------|--------|
| `requester` | PR | 自己PR对应数据 | - |
| `buyer` | PO, Quote, SC, FA | 所有采购数据 | - |
| `manager` | - | 所有数据 | PR, 超收收货 |
| `system` | - | - | -（仅审计日志） |

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
│   │   ├── materials/        # 物料 CRUD + 搜索
│   │   ├── suppliers/        # 供应商 CRUD + 搜索
│   │   ├── purchase-requests/# PR 全流程
│   │   ├── purchase-orders/  # PO 全流程 + 状态筛选
│   │   ├── goods-receipts/   # 收货 + 超收审批
│   │   ├── framework-agreements/
│   │   ├── sourcing-tasks/
│   │   ├── quotes/
│   │   ├── audit-logs/       # 审计日志查询
│   │   └── agent-bindings/   # Agent 注册
│   └── agent-management/      # Agent 管理页面
├── components/
│   └── ui/                   # shadcn/ui 组件
├── lib/
│   ├── api.ts                # API 客户端（含搜索参数）
│   ├── webhook.ts            # Webhook 通知模块
│   ├── agent-notify.ts       # 业务事件通知
│   └── role-filter.ts        # 角色权限过滤
└── storage/
    └── database/
        ├── shared/
        │   └── schema.ts     # 数据库 Schema（含 system 角色）
        ├── number-generator.ts    # 单据编号生成
        ├── fa-matcher.ts         # FA 智能匹配
        └── po-sender.ts          # PO 发送与重试
```

## 数据库

系统使用 Supabase (PostgreSQL)，包含以下核心表：

| 表名 | 说明 |
|------|------|
| `materials` | 物料主数据 |
| `suppliers` | 供应商主数据 |
| `profiles` | 用户/Agent 配置 |
| `purchase_requests` | 采购申请 |
| `purchase_request_lines` | 采购申请行 |
| `sourcing_tasks` | 寻源任务 |
| `quotes` | 报价单 |
| `framework_agreements` | 框架协议 |
| `contracts` | 框架协议（别名） |
| `purchase_orders` | 采购订单 |
| `purchase_order_lines` | 采购订单行 |
| `goods_receipts` | 收货单 |
| `audit_logs` | 审计日志（含 system 角色） |
| `agent_bindings` | Agent 注册（agent_id + role + webhook_url） |
| `webhook_logs` | Webhook 发送记录（幂等、重试审计） |
| `po_send_failures` | PO 发送失败记录（重试队列） |

### 数据库 Migration

```bash
# 执行 migration
psql $DATABASE_URL < drizzle/0001_agent_bindings.sql
psql $DATABASE_URL < drizzle/0002_drop_feishu_columns.sql
```

## 最近更新

### v1.6.0 (2025-03-28)

**重构：**
- ✅ **移除 A2A 相关代码** - 删除 `src/app/api/a2a/` 和相关脚本
- ✅ **统一 Webhook 通知** - 所有业务通知统一使用 Webhook 方式
- ✅ **简化 Agent 管理页面** - 移除任务发送和工作流编排 Tab

**功能增强：**
- ✅ **授标自动创建 PO** - 授标完成后自动创建采购订单并通知 Buyer
- ✅ **超收通知改进** - 直接使用 `notifyManagers` 发送 Webhook 通知

**修复：**
- ✅ **移除 submitted_at 字段** - 修复提交审批数据库错误

### v1.5.0 (2024-03-28)

**新增功能：**
- ✅ **Agent 管理页面** - Web UI 管理已注册的 Agent
  - 查看 Agent 列表
  - 注册新 Agent（需 Manager 权限）
  - 编辑 Agent 角色和 Webhook
  - 删除 Agent（需 Manager 权限）

**API 新增：**
- `GET /api/agent-bindings` - 获取 Agent 列表
- `GET /api/agent-bindings/[id]` - 获取单个 Agent
- `PUT /api/agent-bindings/[id]` - 更新 Agent（需 Manager 权限）
- `DELETE /api/agent-bindings/[id]` - 删除 Agent（需 Manager 权限）

### v1.4.0 (2024-03-25)

**API 状态更新：**
- ✅ **报价单 API** - 真实可用
- ✅ **收货单 API** - 真实可用

**新增功能：**
- ✅ **自动创建采购订单**：采购申请审批通过后，当物料 ID 与框架协议精确匹配时，自动生成采购订单
- ✅ **智能 FA 匹配逻辑**：
  - 物料 ID 精确匹配 → 自动创建 PO
  - 文本相似匹配 → 等待 Buyer 确认

**修复问题：**
- ✅ 统一使用 `Number()` 替代 `parseFloat()` 修复 BigInt 序列化问题
- ✅ 修复超收率计算错误（BigInt 格式导致）

**数据库变更：**
- 添加 `purchase_orders.pr_id` 字段（关联采购申请）

### v1.3.0 (2024-03-25)

**新增功能：**
- ✅ 新增 `POST /api/purchase-orders/[id]/lines` - 批量创建订单行
- ✅ 新增 `GET /api/purchase-orders/[id]/lines` - 获取订单行列表

**修复问题：**
- ✅ 修复采购申请 `items` 参数未生效问题（同时支持 `items` 和 `lines`）
- ✅ 修复供应商 ID 无效时外键约束失败问题（PO/FA/Quote 创建时验证）
- ✅ 供应商不存在时返回清晰错误信息：`无效的供应商 ID: ${id}，该供应商不存在`

**改进：**
- 采购申请返回数据包含完整的行项目 (`lines`)
- 订单行 API 支持 `items` 和 `lines` 两种参数格式
- 增强字段兼容性（驼峰/下划线自动转换）

### v1.1.0 (2024-03-23)

**修复问题：**
- ✅ 修复 `actor_role` 枚举缺失 `system` 值，审计日志插入正常
- ✅ 修复 `po_send_failures` 和 `feishu_notifications` 表缺失问题
- ✅ 修复 FA 取号字段映射错误（`agreement_number` → `fa_number`）
- ✅ 修复 PO 状态筛选不生效问题
- ✅ 修复物料/供应商搜索参数未传递问题
- ✅ 修复 Dashboard 统计数据恒为 0 问题
- ✅ 更新 migration 文件，添加完整的 DDL 语句

**改进：**
- Dashboard 实时统计（PR/PO/供应商/物料数量）
- PO 列表页状态筛选重置分页
- 搜索框输入后重置分页

## 文档

- [Agent 使用指南](AGENTS.md)
- [Agent 绑定实现](docs/AGENT_BINDING.md)
- [待完成设计](DESIGN_PENDING.md)
- [贡献指南](CONTRIBUTING.md)

## License

MIT
