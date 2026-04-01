# Agent 使用指南

本系统面向 Agent 设计，支持通过 HTTP API 进行全流程采购管理。

> **重要**：开发前请先阅读 [API_CONTRACT.md](./API_CONTRACT.md) 了解详细的契约规范和常见问题。

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

```bash
# 只需传 X-Actor，系统自动解析角色
curl -X POST http://localhost:5000/api/purchase-requests \
  -H "Content-Type: application/json" \
  -H "X-Actor: my-procurement-agent" \
  -d '{"reason":"采购办公用品","lines":[{"requirementText":"A4纸","quantity":100}]}'
```

## 身份识别

| 请求头 | 说明 | 可选值 |
|--------|------|--------|
| `X-Actor` | Agent 标识（必填） | `my-agent`, `coze_bot_001` 等 |
| `X-Role` | 角色（可选） | `requester`, `buyer`, `manager` |

**注意**：不传 `X-Role` 时，系统从 `agent_bindings` 表查询该 Agent 的角色。

## 角色权限

| 角色 | 可创建 | 可查看 | 可审批 |
|------|--------|--------|--------|
| `requester` | PR | 自己PR对应数据 | - |
| `buyer` | PO, Quote, SC, FA | 所有采购数据 | - |
| `manager` | - | 所有数据 | PR, 超收收货 |

## 完整业务流程

## Agent 高层动作接口（推荐 Agent 使用）

对于 Agent 调用，推荐优先使用高层动作接口，而不是自己编排多个底层 CRUD / 状态流转接口。

### 1. 创建 PR（自动物料检查）

```bash
POST /api/agent-actions/create-pr-from-material-check
{
  "reason": "办公设备采购",
  "lines": [
    {"requirementText": "无线鼠标", "quantity": 10},
    {"requirementText": "蓝牙键盘", "quantity": 5}
  ],
  "autoSubmit": true,
  "createMissingMaterials": true
}
```

**行为说明**：
- 自动执行物料匹配检查
- 精确匹配时自动使用现有物料
- `createMissingMaterials=true` 时，未匹配物料会自动创建后继续
- 若仍存在需要人工/Agent 二次确认的物料，返回 `requiresConfirmation: true`，不会创建 PR
- `autoSubmit=true` 时，会在创建 PR 后自动提交

### 2. 审批 PR 并处理 FA / 寻源 / 自动 PO

```bash
POST /api/agent-actions/approve-pr-and-handle-fa
{
  "prId": 1,
  "approved": true,
  "note": "预算内，批准"
}
```

**行为说明**：
- 仅 Manager 可调用
- 审批通过后自动执行：
  - FA 精确匹配
  - 需确认的匹配置为 `pending_confirm`
  - 无匹配时自动创建寻源任务
  - FA 精确命中时自动创建 PO

### 3. 授标报价并自动创建 PO

```bash
POST /api/agent-actions/create-po-from-awarded-quote
{
  "quoteId": 12
}
```

**行为说明**：
- 仅 Buyer / Manager 可调用
- 自动完成：
  - 授标报价单
  - 将同寻源任务下其他报价置为 rejected
  - 创建 PO 与 PO 行
  - 更新寻源任务、PR 行状态

### 4. 确认 FA 并自动创建 PO

```bash
POST /api/agent-actions/confirm-fa-and-create-po
{
  "prLineId": 23,
  "faId": 5,
  "confirmed": true,
  "autoCreatePO": true
}
```

**行为说明**：
- 仅 Buyer / Manager 可调用
- `confirmed=true` 时确认 FA 匹配，并可自动创建 PO
- `confirmed=false` 时拒绝 FA 匹配，并自动创建寻源任务

### 5. 收货并自动处理超收

```bash
POST /api/agent-actions/receive-goods-and-handle-overdelivery
{
  "poLineId": 7,
  "quantity": 110,
  "receiptDate": "2026-04-01",
  "notes": "首次到货"
}
```

**行为说明**：
- 仅 Buyer / Manager 可调用
- 正常收货时直接更新 GR / PO 行 / PR 行
- 超收超过阈值时，自动创建待审批 GR，并返回下一步动作提示
- 若传入 `goodsReceiptId` + `approved`，则可直接作为 Manager 审批超收

### 6. 提交合同审批

```bash
POST /api/agent-actions/submit-contract-for-approval
{
  "contractId": 3
}
```

**行为说明**：
- 提交草稿合同进入 `pending`
- 自动写审计日志
- 自动通知 Manager Agent

### 7. 提交 PR（独立动作）

```bash
POST /api/agent-actions/submit-pr
{
  "prId": 15
}
```

**行为说明**：
- 将已创建的草稿 PR 提交到审批流
- 适合在 `create-pr-from-material-check` 未启用 `autoSubmit` 时继续推进

### 8. 审批超收（独立动作）

```bash
POST /api/agent-actions/approve-overdelivery
{
  "goodsReceiptId": 21,
  "approved": true,
  "note": "允许超收"
}
```

**行为说明**：
- 仅 Manager 可调用
- 审批待处理的超收收货单
- 适合在 `receive-goods-and-handle-overdelivery` 返回超收待审批后继续调用

### 9. 动作清单发现接口

```bash
GET /api/agent-actions/manifest
```

**行为说明**：
- 返回所有 agent action 的机器可读清单
- 包含动作名、说明、是否支持幂等、输入字段要求
- 适合 SDK / CLI / MCP 自动发现能力

### 统一响应格式

所有 Agent 高层动作接口统一返回：

```json
{
  "success": true,
  "action": "approve-pr-and-handle-fa",
  "data": {},
  "nextActions": [
    {
      "action": "confirm-fa-and-create-po",
      "reason": "存在待确认 FA 匹配，请继续处理",
      "suggestedPayload": {
        "prLineId": 12,
        "faId": 3,
        "autoCreatePO": true
      }
    }
  ],
  "warnings": [],
  "statusCode": 200
}
```

字段说明：
- `success`: 动作是否成功
- `action`: 当前执行的高层动作名
- `data`: 动作结果主体
- `nextActions`: 推荐给 Agent 的下一步动作
- `nextActions[].suggestedPayload`: 推荐下一步直接可复用的请求体
- `warnings`: 非阻塞告警（如超收待审批）
- `statusCode`: 建议对应的 HTTP 状态码

### 幂等调用（推荐 Agent 使用）

高层动作接口支持以下任一幂等键：

- 请求头：`Idempotency-Key`
- 请求体：`requestId` / `request_id` / `idempotencyKey`

同一 `actor + action + idempotencyKey` 重复调用时，系统会直接返回上次成功结果，避免因 Agent 重试导致重复建单、重复提交或重复收货。

当部署环境提供 `DATABASE_URL` 时，以下关键动作优先使用真实 PostgreSQL 事务：
- `create-pr-from-material-check`
- `confirm-fa-and-create-po`
- `create-po-from-awarded-quote`
- `receive-goods-and-handle-overdelivery`

### 事务与一致性说明

- 创建 PR（header + items）会优先尝试使用 `DATABASE_URL` 走真实数据库事务
- 收货（GR 创建 + PO 行更新 + PO 头状态更新 + PR 行进度更新）也会优先尝试使用 `DATABASE_URL` 走真实数据库事务
- 若当前环境未提供 `DATABASE_URL`，则回退为“写后校验 + 补偿回滚”模式
- 因此在支持直连数据库的部署环境中，PR / PO / GR 关键写链路的一致性会进一步提升，显著降低半成功风险

### 一致性与假成功防护

对于关键多表写入动作（如创建 PR、创建 PO、收货），系统会在返回成功前执行写后校验：

- Header 已写入但 Items 未写入 → 视为失败，并尝试回滚 Header
- 单据号已生成但主记录未成功落库 → 不返回成功
- 关键写入校验失败时 → 返回错误，不向 Agent 谎报“已成功”

**结论**：
- 你提到的“只拿到新单据号，但数据库里并没有真正写入，还回成功”的情况，后续应显著降低
- “Header 成功而 Items 未写入还回成功”的情况，关键动作里已按失败处理并补偿回滚

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

### 3. 框架协议匹配

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

### 7. 查询 Agent 绑定

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
| `POST /api/materials` | Buyer/Manager |
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
