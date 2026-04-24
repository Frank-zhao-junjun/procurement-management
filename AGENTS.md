# Agent 使用指南

本系统面向 Agent 设计，支持通过 **HTTP API** 和 **CLI** 进行全流程采购管理。

> **重要**：开发前请先阅读 [API_CONTRACT.md](./API_CONTRACT.md) 了解详细的契约规范和常见问题。

## CLI 快速入门

系统提供专用 CLI 工具 `procurement`，供 Agent 在终端中快速执行采购管理操作。

### 安装与构建

```bash
# 构建 CLI
pnpm cli:build

# 或直接运行（无需构建）
node cli/bin/procurement.js --help
```

### 配置

```bash
# 配置 API 地址和身份
procurement auth login

# 或指定参数
procurement -u http://localhost:5000 -a my-agent <command>

# 使用 API Key（推荐生产环境）
procurement -u https://your-domain.com -k sk_xxx <command>
```

### 常用命令速查

| 命令 | 说明 |
|------|------|
| `procurement auth register -i my-agent -r buyer` | 注册新 Agent |
| `procurement auth whoami` | 查看当前身份 |
| `procurement material list` | 物料列表 |
| `procurement material match "无线鼠标"` | 物料匹配 |
| `procurement supplier list` | 供应商列表 |
| `procurement pr create` | 交互式创建采购申请 |
| `procurement pr list` | 采购申请列表 |
| `procurement pr submit <id>` | 提交采购申请 |
| `procurement pr approve <lineId>` | 审批 PR 行 |
| `procurement sourcing list` | 寻源任务列表 |
| `procurement sourcing pending` | 待寻源任务 |
| `procurement sourcing update <id> --complete` | 完成寻源 |
| `procurement quote create` | 创建报价单 |
| `procurement quote award <id>` | 授标 |
| `procurement po list` | 采购订单列表 |
| `procurement po create` | 创建采购订单 |
| `procurement po send <id>` | 发送采购订单 |
| `procurement gr create` | 创建收货单 |
| `procurement fa list` | 框架协议列表 |
| `procurement fa match <prLineId>` | 匹配框架协议 |
| `procurement stats overview` | 统计概览 |
| `procurement event list` | 事件列表 |
| `procurement workflow create-pr` | 交互式 PR 创建工作流 |
| `procurement workflow source-to-po` | 交互式寻源到 PO 工作流 |
| `procurement workflow approve-prs` | 交互式审批工作流 |

### 工作流示例

```bash
# Requester 创建并提交 PR
procurement -a my-requester workflow create-pr

# Manager 批量审批
procurement -a my-manager workflow approve-prs

# Buyer 完成寻源到 PO 全流程
procurement -a my-buyer workflow source-to-po
```

## Agent-first 模型

```
一个 Agent ↔ 一个角色
```

- **Agent 优先**：每个 Agent 有唯一 `agent_id` 和固定 `role`
- **角色固定**：`requester` / `buyer` / `manager`
- **事件驱动**：通过 Webhook 订阅业务事件（统一通知通道）

## 事件驱动架构

系统采用事件驱动架构，通过 Webhook 向订阅者推送业务事件。

### 事件类型

| 事件 | 说明 | 订阅角色 |
|------|------|----------|
| `pr_submitted` | 采购申请提交 | Manager |
| `pr_approved` / `pr_rejected` | 采购申请审批结果 | Buyer, Requester |
| `pr_fa_matched` | FA 匹配成功 | Buyer |
| `pr_fa_match_failed` | FA 匹配失败 | Buyer |
| `sourcing_task_created` | 寻源任务创建 | Buyer |
| `quote_awarded` | 报价单中标 | Buyer |
| `po_created` | 采购订单创建 | Buyer |
| `gr_completed` | 收货完成（正常） | Buyer |
| `gr_overdelivery` | 收货超收（>5%） | Manager |

### 订阅规则

```
Buyer 订阅：
- pr_approved → 执行 FA 匹配
- pr_fa_matched → 创建 PO（基于 FA）
- pr_fa_match_failed → 创建寻源任务
- quote_awarded → 创建 PO（基于报价单）
- gr_completed → 推送收货信息

Manager 订阅：
- pr_submitted → 提示审批 PR
- gr_overdelivery → 执行超收审批
```

### Webhook Payload 格式

```json
{
  "schema_version": "1.0",
  "event": "pr_approved",
  "event_id": "uuid-v4",
  "timestamp": "2025-04-01T10:30:00+08:00",
  "source": "pr_approve_api",
  "data": {
    "entity_type": "purchase_request",
    "entity_id": 1,
    "pr_id": 1,
    "pr_number": "PR-20250401-01",
    "approved": true,
    ...
  },
  "subscriber": {
    "agent_id": "my-buyer-agent",
    "role": "buyer"
  }
}
```

### 事件日志

所有事件发送记录保存在 `event_logs` 表：
- `event_id`: 事件唯一标识
- `event_type`: 事件类型
- `source`: 事件来源 API
- `subscribers_notified`: 通知的订阅者数量
- `success`: 分发是否成功

## 快速开始

### 1. 注册 Agent

任意 Agent 均可注册新 Agent，注册时自行选择角色（requester / buyer / manager），无需 Manager 审批。

```bash
# 注册仅角色的 Agent
POST /api/agent-bindings
Content-Type: application/json
{
  "agentId": "my-procurement-agent",
  "role": "buyer"
}

# 注册 Manager Agent（配置 Webhook 接收待审批通知）
POST /api/agent-bindings
{
  "agentId": "my-manager-agent",
  "role": "manager",
  "webhookUrl": "https://your-server.com/webhook"
}
```

> **注意**：Agent ID 注册后不可修改，角色由注册时选定。Web 前端默认使用 `web:requester`、`web:buyer`、`web:manager` 三个内置 Agent，系统启动时会自动注册。

## Webhook 通知

Manager Agent 可以配置 Webhook URL 接收实时通知。

### PR 提交通知

当有采购申请提交时，系统会向所有 Manager Agent 的 Webhook URL 发送 POST 请求：

```json
{
  "event": "pr_submitted",
  "prId": 1,
  "prNumber": "PR-20250401-01",
  "submittedBy": "requester-agent",
  "submittedAt": "2025-04-01T10:30:00+08:00"
}
```

**前提条件**：
- Agent 必须注册时提供 `webhookUrl`
- Agent 角色必须为 `manager`
- Webhook URL 必须可被公网访问（https:// 或 http://）

### Webhook 请求头

```http
POST /your-webhook-url HTTP/1.1
Content-Type: application/json
User-Agent: ProcurementSystem-Webhook/1.0
```

### 响应要求

- 返回 2xx 状态码表示成功
- 超时时间：10 秒
- 支持重试（由调用方负责）

### 支持的事件

#### 1. PR 提交
```json
{
  "event": "pr_submitted",
  "prId": 1,
  "prNumber": "PR-20250401-01",
  "submittedBy": "requester-agent",
  "submittedAt": "2025-04-01T10:30:00+08:00"
}
```

#### 2. 超收待审批
```json
{
  "event": "overdelivery_pending",
  "grId": 1,
  "grNumber": "GR-20250401-01",
  "poId": 1,
  "poLineId": 1,
  "orderQty": 100,
  "grQuantity": 110,
  "overdeliveryRatio": 0.1,
  "requestedBy": "buyer-agent",
  "requestedAt": "2025-04-01T14:30:00+08:00"
}
```

## 身份识别

| 请求头 | 说明 | 可选值 |
|--------|------|--------|
| `X-API-Key` | API Key 验证（**推荐生产使用**） | `sk_xxx` 格式 |
| `X-Actor` | Agent 标识（已注册 Agent） | `my-agent`, `coze_bot_001` 等 |
| `X-Role` | **已禁用**（防止角色伪造） | - |

**认证优先级**：
1. `X-API-Key`（最高）：API Key 验证，权威来源，不可伪造
2. `X-Actor`：从 `agent_bindings` 表查询角色（**仅限已注册 Agent**）

**安全约束（角色不可伪造）**：
- `X-Role` 已**完全禁用**，Agent 无法通过请求头更改自己的角色
- `X-Actor` 必须已在 `agent_bindings` 中注册，未注册 Agent 请求将被拒绝
- 使用 `X-API-Key` 时，若同时传 `X-Actor`，两者必须匹配
- `agent_id` 是核心标识，**注册后不可修改**
- 角色由 Manager 在注册时固定，Agent 无法自行更改

**注意**：
- Agent 角色由系统管理，存储在 `agent_bindings` 表中
- 使用 `X-API-Key` 时，无需传 `X-Actor` 和 `X-Role`，系统自动解析

### API Key 管理

```bash
# Manager 为 Agent 生成 API Key
POST /api/agent-bindings/{id}/api-key
-H "X-Actor: manager-agent"

# 返回示例
{
  "success": true,
  "agentId": "my-buyer-agent",
  "apiKey": "sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "message": "请妥善保管 API Key，创建后无法再次查看明文"
}

# Manager 清除 Agent 的 API Key
DELETE /api/agent-bindings/{id}/api-key
-H "X-Actor: manager-agent"
```

### Agent ID 不可修改

```bash
# 尝试修改 agent_id 会被拒绝
PUT /api/agent-bindings/{id}
{"agentId": "new-id"}
# 返回: {"error": "agent_id 是核心标识，注册后不可修改"}
```

### 使用 API Key 调用

```bash
# 使用 API Key（推荐）
curl -X POST http://localhost:5000/api/purchase-requests \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -d '{"reason":"采购办公用品","lines":[{"requirementText":"A4纸","quantity":100}]}'

# 简单模式（仅开发/内网）
curl -X POST http://localhost:5000/api/purchase-requests \
  -H "Content-Type: application/json" \
  -H "X-Actor: my-procurement-agent" \
  -d '{"reason":"采购办公用品","lines":[{"requirementText":"A4纸","quantity":100}]}'
```

## 角色权限

### 粗粒度权限（基础角色）

| 角色 | 可创建 | 可查看 | 可审批 |
|------|--------|--------|--------|
| `requester` | PR, Material | 自己PR对应数据 | - |
| `buyer` | PO, Quote, SC, FA, Material | 所有采购数据 | - |
| `manager` | - | 所有数据 | PR, 超收收货 |

### 细粒度权限（详细矩阵）

| 资源 | 操作 | buyer | requester | manager |
|------|------|-------|-----------|---------|
| **物料 (materials)** | 列表/详情 | ✅ | ✅ | ✅ |
| | 创建 | ✅ | ✅ | ✅ |
| **供应商 (suppliers)** | 列表/详情 | ✅ | ✅ (只读) | ✅ (只读) |
| | 创建 | ✅ | ❌ | ❌ |
| **采购申请 (purchase_requests)** | 列表/详情 | ✅ | ✅ | ✅ |
| | 创建 | ❌ | ✅ | ❌ |
| | 提交 | ❌ | ✅ | ❌ |
| | 审批 | ❌ | ❌ | ✅ |
| **寻源任务 (sourcing_tasks)** | 列表/详情 | ✅ | ✅ (关联PR) | ✅ |
| | 创建 | ✅ | ❌ | ❌ |
| | 更新 | ✅ | ❌ | ❌ |
| **报价单 (quotes)** | 列表/详情 | ✅ | ✅ (只读) | ✅ (只读) |
| | 创建 | ✅ | ❌ | ❌ |
| | 授标 | ✅ | ❌ | ❌ |
| **框架协议 (framework_agreements)** | 列表/详情 | ✅ | ✅ (只读) | ✅ |
| | 审批 | ❌ | ❌ | ✅ |
| **采购订单 (purchase_orders)** | 列表/详情 | ✅ | ✅ (关联PR) | ✅ |
| | 创建 | ✅ | ❌ | ❌ |
| | 发送 | ✅ | ❌ | ❌ |
| **收货单 (goods_receipts)** | 列表/详情 | ✅ | ✅ | ✅ |
| | 创建 | ✅ | ✅ | ❌ |
| | 超收审批 | ❌ | ❌ | ✅ |

### MCP 工具权限

MCP 工具权限与 REST API 权限对齐：

| 工具 | buyer | requester | manager |
|------|-------|-----------|---------|
| match_material | ✅ | ✅ | ✅ |
| list_materials | ✅ | ✅ | ✅ |
| create_material | ✅ | ✅ | ✅ |
| list_suppliers | ✅ | ✅ | ✅ |
| create_supplier | ✅ | ❌ | ❌ |
| create_purchase_request | ❌ | ✅ | ❌ |
| list_purchase_requests | ✅ | ✅ | ✅ |
| submit_purchase_request | ❌ | ✅ | ❌ |
| create_sourcing_task | ✅ | ❌ | ❌ |
| list_sourcing_tasks | ✅ | ✅ | ✅ |
| get_pending_sourcing | ✅ | ❌ | ✅ |
| update_sourcing_task | ✅ | ❌ | ❌ |
| create_quote | ✅ | ❌ | ❌ |
| award_quote | ✅ | ❌ | ❌ |
| create_purchase_order | ✅ | ❌ | ❌ |
| send_purchase_order | ✅ | ❌ | ❌ |
| create_goods_receipt | ✅ | ✅ | ❌ |
| list_goods_receipts | ✅ | ✅ | ✅ |

## 完整业务流程

### 0. 物料匹配检查（推荐第一步）

**重要**：在创建采购申请前，建议先检查物料匹配情况，避免后续流程中断。

```bash
# 单个物料匹配检查
GET /api/materials/match?text=无线鼠标

# 返回示例
{
  "found": true,
  "exactMatch": {"id": 5, "code": "MAT001", "name": "无线鼠标", "unit": "个"},
  "suggestions": [],
  "action": "use_existing",  // use_existing | create_new | confirm
  "message": "找到精确匹配的物料: 无线鼠标"
}
```

**返回的 action 说明**：
- `use_existing`: 找到精确匹配，可直接使用现有物料
- `create_new`: 未找到匹配，建议创建新物料
- `confirm`: 找到相似物料，需要用户确认

**批量检查 PR 物料**：

```bash
POST /api/purchase-requests/check-materials
{
  "lines": [
    {"requirementText": "无线鼠标", "quantity": 10},
    {"requirementText": "蓝牙键盘", "quantity": 5}
  ]
}

# 返回示例
{
  "canProceed": false,  // true 表示可以直接创建 PR
  "summary": {
    "total": 2,
    "exactMatches": 1,
    "needConfirm": 0,
    "notFound": 1
  },
  "nextAction": "confirm_materials",  // create_pr | confirm_materials | all_cancelled
  "lines": [
    {
      "requirementText": "无线鼠标",
      "found": true,
      "exactMatch": {"id": 5, "name": "无线鼠标"},
      "action": "use_existing"
    },
    {
      "requirementText": "蓝牙键盘",
      "found": false,
      "exactMatch": null,
      "suggestions": [],
      "action": "create_new"
    }
  ]
}
```

### 1. 创建采购申请（带物料确认）

**参数说明**：
- `items` 和 `lines` 参数等效，都可用于传递行项目数据
- 支持驼峰 (`items`) 和下划线 (`items` 或 `items`) 两种格式

**场景 A：所有物料都有精确匹配** → 直接创建 PR

```bash
# 使用 items 参数
POST /api/purchase-requests
{
  "reason": "办公设备采购",
  "items": [
    {"requirementText": "无线鼠标", "quantity": 10}
  ]
}

# 或使用 lines 参数（效果相同）
POST /api/purchase-requests
{
  "reason": "办公设备采购",
  "lines": [
    {"requirementText": "无线鼠标", "quantity": 10}
  ]
}
```

**场景 B：部分物料需要确认** → 使用确认接口

```bash
# 用户确认后创建 PR（可选择使用现有物料或创建新物料）
POST /api/purchase-requests/confirm-materials
{
  "reason": "办公设备采购",
  "lines": [
    {
      "requirementText": "无线鼠标",
      "quantity": 10,
      "confirmedMaterialId": 5  // 使用现有物料
    },
    {
      "requirementText": "蓝牙键盘",
      "quantity": 5,
      "confirmedMaterialName": "蓝牙键盘",  // 创建新物料
      "confirmedMaterialUnit": "个"
    }
  ],
  "cancelledLines": []  // 用户取消的行索引
}

# 返回示例
{
  "created": true,
  "data": {
    "id": 8,
    "pr_number": "PR-20260323-03",
    "status": "draft",
    "lines_count": 2,
    "new_materials": [{"id": 9, "name": "蓝牙键盘", "unit": "个"}]
  }
}
```

**场景 C：用户取消所有行** → 不创建 PR

```bash
POST /api/purchase-requests/confirm-materials
{
  "reason": "测试取消",
  "lines": [...],
  "cancelledLines": [0, 1, 2]  // 取消所有行
}

# 返回
{
  "created": false,
  "message": "所有采购行已被取消，采购申请未创建"
}
```

### 2. 提交与审批 PR

```bash
# 提交采购申请（触发通知给 Manager Agent）
POST /api/purchase-requests/{id}/submit

# 返回示例
{
  "data": {
    "id": 1,
    "pr_number": "PR-20250401-01",
    "status": "pending"
  },
  "notification": {
    "success": true,
    "results": [{"agent": "manager-agent", "success": true}]
  }
}

# Manager 审批通过
POST /api/purchase-request-lines/{id}/approve
{"approved": true}

# Manager 审批拒绝
POST /api/purchase-request-lines/{id}/approve
{"approved": false, "reason": "超出预算"}
```

### 3. 修改与撤回已提交的采购申请

```bash
# 修改采购申请（支持草稿和待审批状态）
PUT /api/purchase-requests/{id}
-H "X-Actor: requester-agent"
{
  "reason": "更新采购原因",
  "lines": [
    {"requirementText": "无线鼠标", "quantity": 15}
  ]
}

# 返回示例（待审批状态会先撤回再修改）
{
  "data": {...},
  "withdrawn": true,
  "message": "采购申请已撤回（草稿状态），修改成功。需要重新提交。"
}

# 撤回采购申请（仅待审批状态）
POST /api/purchase-requests/{id}/withdraw
-H "X-Actor: requester-agent"

# 返回示例
{
  "success": true,
  "data": {
    "id": 1,
    "prNumber": "PR-20250401-01",
    "previousStatus": "pending",
    "currentStatus": "draft"
  },
  "message": "采购申请已撤回，可以修改后重新提交"
}

# 检查是否可以撤回
GET /api/purchase-requests/{id}/withdraw
-H "X-Actor: requester-agent"

# 返回示例
{
  "data": {
    "id": 1,
    "prNumber": "PR-20250401-01",
    "status": "pending",
    "canWithdraw": true,
    "reason": null
  }
}
```

**状态规则**：
| 当前状态 | 可修改 | 可撤回 | 说明 |
|----------|--------|--------|------|
| `draft` | ✅ | ❌ | 草稿状态可直接修改 |
| `pending` | ✅ | ✅ | 待审批：修改时自动撤回为草稿，修改后需重新提交 |
| `approved` | ❌ | ❌ | 已审批：不可修改 |
| `rejected` | ❌ | ❌ | 已拒绝：不可修改，可删除后重新创建 |

### 4. 框架协议匹配

审批通过后，系统自动匹配框架协议：
- 状态设为 `pending_confirm`（待确认，非静默）
- 返回 Top-3 候选方案

```bash
# 查询匹配结果
GET /api/purchase-request-lines/{id}/match?topN=3

# 确认 FA 匹配
PUT /api/purchase-request-lines/{id}/confirm-fa
{"faId": 1, "confirmed": true, "autoCreatePO": false}

# 拒绝并创建寻源任务
PUT /api/purchase-request-lines/{id}/confirm-fa
{"confirmed": false}

# 提交框架协议审批（触发通知给 Manager Agent）
POST /api/contracts/{id}/submit

# 返回示例
{
  "data": {
    "id": 1,
    "title": "办公用品采购协议",
    "status": "pending"
  },
  "notification": {
    "success": true,
    "results": [{"agent": "manager-agent", "success": true}]
  }
}
```

### 4. 寻源与报价

```bash
# 获取待寻源的采购申请行（FA匹配失败或需要寻源的PR行）
GET /api/sourcing-tasks/pending
-H "X-Actor: buyer-agent"

# 获取寻源任务详情
GET /api/sourcing-tasks/{id}
-H "X-Actor: buyer-agent"

# 更新寻源任务（分配供应商、完成寻源等）
PUT /api/sourcing-tasks/{id}
-H "X-Actor: buyer-agent"
{
  "supplierId": 1,
  "result": "找到合适供应商"
}

# 或使用快捷完成
PUT /api/sourcing-tasks/{id}
{
  "supplierId": 1,
  "complete": true
}

# 创建报价单
POST /api/quotes
{
  "sourcingTaskId": 1,
  "supplierId": 1,
  "unitPrice": 0.045,
  "quantity": 500
}

# 授标（单一中标）
PUT /api/quotes/{id}
{"awarded": "winner"}
```

**寻源任务状态**：
- `pending` - 待处理
- `in_progress` - 进行中
- `completed` - 已完成
- `cancelled` - 已取消

### 5. 采购订单 (PO)

```bash
# 创建 PO（供应商 ID 必须存在，否则返回 400 错误）
POST /api/purchase-orders
{
  "supplierId": 10,
  "supplierSnapshot": "小米",
  "lines": [
    {"prLineId": 1, "quantity": 500, "unitPrice": 0.045}
  ]
}

# 向已有 PO 添加订单行
POST /api/purchase-orders/{id}/lines
-H "X-Role: buyer"
{
  "items": [
    {"materialSnapshot": "键盘", "quantity": 10, "unitPrice": 200}
  ]
}

# 获取订单行列表
GET /api/purchase-orders/{id}/lines

# 发送 PO（支持失败重试）
POST /api/purchase-orders/{id}/send

# 重试发送（3次：1min间隔）
POST /api/purchase-orders/{id}/retry
```

### 6. 收货与超收

```bash
# 收货
POST /api/goods-receipts
{"poLineId": 1, "quantity": 500}

# 超收 5% 以上需 Manager 审批
POST /api/goods-receipts
{"poLineId": 1, "quantity": 530}

# Manager 审批超收
POST /api/goods-receipts/{id}/approve-overdelivery
{"approved": true}

# 退货
POST /api/goods-receipts
{"poLineId": 1, "quantity": 10, "grType": "out"}
```

### 7. 退货审批

```bash
# Manager 获取待审批退货列表
GET /api/goods-receipts/returns/pending
-H "X-Actor: manager-agent"

# Manager 审批退货（批准）
POST /api/goods-receipts/returns/{id}/approve
{"approved": true, "reason": "货物质量合格，无需退货"}

# Manager 审批退货（拒绝）
POST /api/goods-receipts/returns/{id}/approve
{"approved": false, "reason": "货物已使用，不符合退货条件"}
```

### 8. 物料历史价格查询

```bash
# 查询物料价格历史
GET /api/materials/{id}/price-history

# 返回示例
{
  "data": {
    "materialId": 5,
    "statistics": {
      "avgPrice": 45.00,
      "minPrice": 38,
      "maxPrice": 52,
      "latestPrice": 42,
      "count": 15
    },
    "history": [...]
  }
}
```

### 9. 多供应商比价

```bash
# 按物料名称比价
GET /api/materials/compare-price?materialName=无线鼠标

# 返回示例
{
  "data": {
    "totalSuppliers": 3,
    "marketAvgPrice": 48.50,
    "lowestPriceSupplier": {
      "name": "小米",
      "avgPrice": 42.00,
      "diffFromMarket": -6.50,
      "diffPercent": -13
    },
    "suppliers": [
      {"supplierName": "小米", "avgPrice": 42.00, "quoteCount": 5, ...},
      {"supplierName": "罗技", "avgPrice": 48.00, "quoteCount": 3, ...},
      {"supplierName": "雷柏", "avgPrice": 55.00, "quoteCount": 2, ...}
    ]
  }
}
```

### 10. 价格预警

价格预警在创建报价单时自动触发。当报价高于历史均价 10% 或价格波动超过 50% 时，会触发预警事件通知 Buyer 和 Manager。

```bash
# 预警事件（自动触发，无需手动调用）
# 事件类型: price.high, price.abnormal
# 订阅角色: buyer, manager
```

### 11. 审计日志

```bash
# 查询审计日志
GET /api/audit-logs?entityType=purchase_request&entityId=1

# 获取实体变更历史
GET /api/audit-logs/entity/purchase_request/1

# 获取审计统计（Manager only）
GET /api/audit-logs/statistics?from=2026-01-01&to=2026-03-31

# 返回示例
{
  "data": {
    "period": {"from": "2026-01-01", "to": "2026-03-31"},
    "byEntityType": {
      "purchase_request": 45,
      "purchase_order": 32,
      "goods_receipt": 28
    },
    "byAction": {
      "create": 50,
      "update": 30,
      "approve": 20
    },
    "byActor": {
      "buyer-agent": {"count": 45, "role": "buyer"},
      "requester-agent": {"count": 35, "role": "requester"}
    }
  }
}
```

### 12. 数据统计分析

```bash
# 获取概览统计
GET /api/statistics/overview?period=month

# 返回示例
{
  "data": {
    "period": "month",
    "startDate": "2026-03-01T00:00:00.000Z",
    "endDate": "2026-03-25T...",
    "purchaseRequests": {
      "total": 45,
      "byStatus": {"draft": 5, "pending": 10, "approved": 30}
    },
    "purchaseOrders": {
      "total": 32,
      "totalAmount": 156000.00,
      "avgAmount": 4875.00
    },
    "goodsReceipts": {
      "total": 28,
      "received": 1200,
      "returned": 50,
      "netReceived": 1150
    },
    "suppliers": {"total": 15, "active": 12, "inactive": 3},
    "materials": {"total": 200, "active": 180, "inactive": 20}
  }
}

# 获取趋势数据
POST /api/statistics/trend
{
  "metric": "po_amount",
  "period": "month",
  "periods": 6
}

# 返回示例
{
  "data": {
    "metric": "po_amount",
    "period": "month",
    "periods": 6,
    "trend": [
      {"date": "2025-10", "value": 120000},
      {"date": "2025-11", "value": 135000},
      {"date": "2025-12", "value": 110000},
      {"date": "2026-01", "value": 145000},
      {"date": "2026-02", "value": 160000},
      {"date": "2026-03", "value": 156000}
    ],
    "summary": {
      "avg": 137666.67,
      "min": 110000,
      "max": 160000,
      "latest": 156000,
      "change": -4000
    }
  }
}
```

### 13. 事件发布与订阅

```bash
# 发布事件
POST /api/events
{
  "type": "pr.submitted",
  "data": {
    "prId": 1,
    "prNumber": "PR-20260325-01"
  },
  "routing": {
    "targetRoles": ["manager"]
  }
}

# 查询事件列表
GET /api/events?type=pr.submitted&from=2026-03-01

# 查询单个事件
GET /api/events/{eventId}

# 获取订阅列表
GET /api/agent-bindings/{id}/subscriptions

# 更新订阅
PUT /api/agent-bindings/{id}/subscriptions
{
  "subscriptions": ["pr.submitted", "gr.overdelivered", "price.high"],
  "webhookUrl": "https://your-server.com/webhook"
}

# 设置默认订阅
POST /api/agent-bindings/{id}/subscriptions/defaults
```

### 14. 查询 Agent 绑定

```bash
# 查询绑定状态
GET /api/agent-bindings?agentId=my-agent

# 按角色查询
GET /api/agent-bindings?role=manager
```

## 编号规则

| 单据 | 前缀 | 格式 | 示例 |
|------|------|------|------|
| 采购申请 | PR- | PR-YYYYMMDD-序号 | PR-20250401-01 |
| 寻源任务 | SC- | SC-YYYYMMDD-序号 | SC-20250401-01 |
| 报价单 | Q- | Q-六位序号 | Q-000001 |
| 框架协议 | FA- | FA-YYYYMMDD-序号 | FA-20250401-01 |
| 采购订单 | PO- | PO-YYYYMMDD-序号 | PO-20250401-01 |
| 收货单 | GR- | GR-YYYYMMDD-序号 | GR-20250401-01 |
| 退货单 | RT- | RT-YYYYMMDD-序号 | RT-20250401-01 |

- 时区：Asia/Shanghai
- 日流水号：01-99（超出返回错误）

## 敏感接口权限

| 接口 | 权限要求 |
|------|----------|
| `GET /api/goods-receipts/pending-approval` | Manager only |
| `GET /api/audit-logs` | Manager 看全部，其他人看自己 |
| `POST /api/materials` | 所有角色 |
| `POST /api/suppliers` | Buyer/Manager |
| `GET /api/purchase-orders/{id}` | Requester 只能看自己PR对应的PO |

## 错误处理

| 状态码 | 说明 |
|--------|------|
| 400 | 请求参数错误（如：无效的供应商 ID: 17，该供应商不存在） |
| 403 | 无权限操作 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

**常见错误信息**：
- `无效的供应商 ID: ${id}，该供应商不存在` - 供应商 ID 不存在于 suppliers 表
- `只能向草稿状态的订单添加行` - PO 已发送或完成，无法修改
- `只有 Buyer 或 Manager 可以添加订单行` - 权限不足 |

## MCP Server (Model Context Protocol)

系统提供 MCP Server，供 Agent 通过 MCP 协议调用采购管理功能。

### 启动 MCP Server

```bash
# 启动 MCP Server (端口 5001)
pnpm start:mcp

# MCP Server 地址
# http://localhost:5001/mcp
```

生产/联调请在请求头携带 **`Authorization: Bearer <token>`**（Token 由 `MCP_API_KEY_SECRET` 与已注册的 `agent_id` 生成，见 `pnpm mcp:token <agent_id>` 与 [MCP_INTEGRATION.md](./MCP_INTEGRATION.md)）。未配置 `MCP_API_KEY_SECRET` 时仅开发环境可使用占位身份。同域部署推荐 Nginx 将 `https://你的域名/mcp` 反代到本服务并**透传 `Authorization`**。

### MCP 工具列表

| 工具名称 | 说明 | 角色 |
|----------|------|------|
| `match_material` | 检查物料是否已存在 | 所有 |
| `list_materials` | 查询物料列表 | 所有 |
| `create_material` | 创建新物料 | 所有 |
| `list_suppliers` | 查询供应商列表 | buyer/manager |
| `create_supplier` | 创建新供应商 | buyer/manager |
| `create_purchase_request` | 创建采购申请 | requester |
| `list_purchase_requests` | 查询采购申请列表 | 所有 |
| `submit_purchase_request` | 提交采购申请 | requester |
| `create_sourcing_task` | 创建寻源任务 | buyer |
| `list_sourcing_tasks` | 查询寻源任务列表 | buyer/manager |
| `get_pending_sourcing` | 获取待寻源的PR行 | buyer/manager |
| `get_sourcing_task` | 获取寻源任务详情 | buyer/manager |
| `update_sourcing_task` | 更新寻源任务 | buyer |
| `create_quote` | 创建报价单 | buyer |
| `award_quote` | 授标报价单 | buyer |
| `create_purchase_order` | 创建采购订单 | buyer |
| `send_purchase_order` | 发送采购订单 | buyer |
| `list_purchase_orders` | 查询采购订单列表 | 所有 |
| `create_goods_receipt` | 创建收货单 | buyer |
| `list_goods_receipts` | 查询收货单列表 | buyer/manager |
| `match_framework_agreement` | 查询框架协议匹配 | buyer |

### MCP 协议示例

```bash
# 1. 初始化连接
curl -X POST http://localhost:5001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"agent","version":"1.0"}}}'

# 2. 发送 initialized 通知
curl -X POST http://localhost:5001/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: <SESSION_ID>" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}'

# 3. 调用工具 (match_material 示例)
curl -X POST http://localhost:5001/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: <SESSION_ID>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"match_material","arguments":{"text":"无线鼠标"}}}'
```
