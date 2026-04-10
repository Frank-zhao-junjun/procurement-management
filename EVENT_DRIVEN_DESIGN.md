# Event-Driven Agent 协作架构设计

## 1. 架构概述

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Event Bus (事件总线)                           │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                        事件发布/订阅中心                          │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
         │                              │                              │
         ▼                              ▼                              ▼
┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐
│   Requester     │           │     Buyer      │           │    Manager     │
│    Agent        │           │    Agent       │           │     Agent      │
│                 │           │                 │           │                 │
│ - 创建 PR       │           │ - FA 匹配      │           │ - 审批 PR       │
│ - 提交 PR       │           │ - 寻源         │           │ - 审批超收      │
│ - 确认物料      │           │ - 报价授标     │           │ - 审批退货      │
│ - 确认 FA      │           │ - 创建 PO      │           │                 │
│ - 收货/退货    │           │ - 发送 PO      │           │                 │
└─────────────────┘           └─────────────────┘           └─────────────────┘
         ▲                              ▲                              ▲
         │                              │                              │
         └──────────────────────────────┴──────────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    │         事件订阅规则              │
                    │                                  │
                    │  role → 订阅事件列表               │
                    │  agentId → 个性化事件              │
                    └─────────────────────────────────┘
```

## 2. 事件类型定义

### 2.1 事件分类

| 类别 | 事件前缀 | 说明 |
|------|----------|------|
| 采购申请 | `pr.*` | PR 生命周期事件 |
| 寻源 | `sourcing.*` | 寻源任务事件 |
| 报价 | `quote.*` | 报价单事件 |
| 采购订单 | `po.*` | PO 生命周期事件 |
| 收货 | `gr.*` | 收货/退货事件 |
| 价格预警 | `price.*` | 价格异常预警 |
| 系统 | `system.*` | 系统级事件 |

### 2.2 完整事件列表

```typescript
// ========== 采购申请事件 ==========
pr.created          // PR 已创建（草稿）
pr.submitted        // PR 已提交待审批
pr.approved         // PR 审批通过
pr.rejected         // PR 审批拒绝
pr.partially_approved // PR 部分行审批通过

// ========== 寻源事件 ==========
sourcing.created    // 寻源任务创建
sourcing.completed  // 寻源完成（找到供应商）
sourcing.failed     // 寻源失败（无合适供应商）
sourcing.cancelled // 寻源任务取消

// ========== 报价事件 ==========
quote.created       // 报价单创建
quote.awarded      // 报价单授标
quote.rejected      // 报价单拒绝

// ========== 采购订单事件 ==========
po.created          // PO 创建
po.sent             // PO 已发送
po.received         // 供应商确认签收
po.cancelled        // PO 取消

// ========== 收货事件 ==========
gr.created          // 收货单创建
gr.completed        // 收货完成
gr.overdelivered    // 收货超收（>5%）
gr.return_requested // 退货申请
gr.return_approved  // 退货审批通过
gr.return_completed // 退货完成

// ========== 价格预警事件 ==========
price.high          // 价格高于历史均价 10%
price.abnormal      // 价格异常（波动 >50%）
price.updated       // 物料价格更新

// ========== 系统事件 ==========
system.ready        // 系统就绪
system.error        // 系统错误
```

### 2.3 事件 Payload 结构

```typescript
interface Event<T = unknown> {
  id: string;              // 事件唯一 ID (UUID)
  type: string;            // 事件类型
  version: string;          // 事件版本 (1.0)
  timestamp: string;        // 事件时间 (ISO 8601)
  source: string;           // 事件来源服务
  correlationId?: string;   // 关联 ID（用于追踪业务流程）
  causedBy?: string;       // 触发原因 (user_id / system)
  
  // 事件数据（不同事件类型有不同结构）
  data: T;
  
  // 路由信息
  routing: {
    targetRoles?: Role[];      // 目标角色
    targetAgentIds?: string[];  // 目标 Agent
    broadcast?: boolean;        // 是否广播
  };
  
  // 元数据
  metadata?: {
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    retryable?: boolean;
    ttl?: number;             // 过期时间（秒）
  };
}
```

### 2.4 事件示例

```json
// PR 提交事件
{
  "id": "evt_20260325_001",
  "type": "pr.submitted",
  "version": "1.0",
  "timestamp": "2026-03-25T10:30:00+08:00",
  "source": "purchase-request-service",
  "correlationId": "pr_20260325_01",
  "causedBy": "requester-agent",
  "data": {
    "prId": 1,
    "prNumber": "PR-20260325-01",
    "submitter": "requester-agent",
    "totalAmount": 5000,
    "linesCount": 3,
    "priority": "normal"
  },
  "routing": {
    "targetRoles": ["manager"]
  }
}

// 价格预警事件
{
  "id": "evt_20260325_002",
  "type": "price.high",
  "version": "1.0",
  "timestamp": "2026-03-25T11:00:00+08:00",
  "source": "price-service",
  "correlationId": "q_000001",
  "data": {
    "materialId": 5,
    "materialName": "无线鼠标",
    "quotedPrice": 55,
    "historicalAvgPrice": 45,
    "priceIncreaseRatio": 0.22,
    "warningThreshold": 0.10
  },
  "routing": {
    "targetRoles": ["buyer", "manager"]
  },
  "metadata": {
    "priority": "high"
  }
}
```

## 3. 事件发布接口

### 3.1 发布事件 API

```bash
POST /api/events
Content-Type: application/json
X-Actor: buyer-agent

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
```

### 3.2 事件查询 API

```bash
# 查询事件列表
GET /api/events?type=pr.submitted&from=2026-03-01&limit=100

# 查询事件详情
GET /api/events/{eventId}

# 查询事件历史（按关联 ID）
GET /api/events?correlationId=pr_20260325_01
```

## 4. 事件订阅机制

### 4.1 订阅配置

Agent 注册时可以配置 Webhook URL 接收事件通知：

```typescript
// 注册时配置
POST /api/agent-bindings
{
  "agentId": "manager-agent",
  "role": "manager",
  "webhookUrl": "https://your-server.com/webhook",
  "subscriptions": [
    "pr.submitted",      // PR 提交通知
    "pr.approved",       // PR 审批结果
    "pr.rejected",
    "gr.overdelivered", // 超收通知
    "gr.return_requested", // 退货申请
    "price.high",        // 价格预警
    "price.abnormal"
  ]
}
```

### 4.2 订阅管理 API

```bash
# 更新订阅
PUT /api/agent-bindings/{id}/subscriptions
{
  "subscriptions": [
    "pr.submitted",
    "gr.overdelivered"
  ]
}

# 获取订阅列表
GET /api/agent-bindings/{id}/subscriptions
```

## 5. Webhook 投递

### 5.1 投递机制

```
┌─────────┐    事件     ┌──────────┐    HTTP POST     ┌────────────┐
│ Event   │ ──────────▶ │ Webhook  │ ────────────────▶ │ Agent      │
│ Bus     │             │ Dispatcher│                 │ Server     │
└─────────┘             └──────────┘                  └────────────┘
                              │
                              │ 失败重试
                              ▼
                         ┌──────────┐
                         │ Retry    │
                         │ Queue    │
                         └──────────┘
                              │
                         ┌────┴────┐
                         │ 1min    │
                         │ 5min    │
                         │ 15min   │
                         │ 1hour   │
                         └─────────┘
                              │
                              │ 最终失败
                              ▼
                        ┌──────────┐
                        │ Dead     │
                        │ Letter   │
                        └──────────┘
```

### 5.2 Webhook Payload

```json
{
  "event": {
    "id": "evt_20260325_001",
    "type": "pr.submitted",
    "timestamp": "2026-03-25T10:30:00+08:00",
    "data": { ... }
  },
  "delivery": {
    "attempt": 1,
    "maxAttempts": 4,
    "signature": "sha256=xxx"  // 用于校验
  }
}
```

## 6. 事件处理工作流

### 6.1 PR 审批流程

```
Requester          System              Manager            Buyer
   │                 │                    │                 │
   │──PR Created────▶│                    │                 │
   │                 │                    │                 │
   │──Submit PR─────▶│                    │                 │
   │                 │──Event────────────▶│                 │
   │                 │  pr.submitted      │                 │
   │                 │                    │                 │
   │                 │◀──Approve──────────│                 │
   │                 │                    │                 │
   │◀──Event─────────│                    │                 │
   │  pr.approved    │                    │                 │
   │                 │                    │                 │
   │                 │──Event────────────────────────────▶│
   │                 │  pr.approved      │                 │
   │                 │                    │                 │
```

### 6.2 报价单价格预警流程

```
Buyer              Price Service        System              Manager
 │                      │                   │                    │
 │──Create Quote───────▶│                   │                    │
 │  price=55            │                   │                    │
 │                      │                   │                    │
 │                 Check Price              │                    │
 │                 Historical Avg=45        │                    │
 │                 Increase=22% > 10%       │                    │
 │                      │                   │                    │
 │                      │──Trigger Event──────────────────────▶│
 │                      │  price.high       │                    │
 │                      │                   │                    │
 │◀──Return Warning─────│                   │                    │
 │  "价格高于均价22%"    │                   │                    │
 │                      │                   │                    │
```

### 6.3 退货申请流程

```
Buyer/Requester      System              Manager
     │                  │                    │
     │──Return GR─────▶│                    │
     │                  │                    │
     │                  │──Event────────────▶│
     │                  │  gr.return_requested
     │                  │                    │
     │                  │◀──Approve─────────│
     │                  │                    │
     │◀──Event───────────│                    │
     │  gr.return_approved                   │
     │                  │                    │
```

## 7. 数据库设计

### 7.1 事件表 (events)

```sql
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  version VARCHAR(10) DEFAULT '1.0',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source VARCHAR(100) NOT NULL,
  correlation_id VARCHAR(100),
  caused_by VARCHAR(100),
  data JSONB NOT NULL,
  routing JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_correlation ON events(correlation_id);
CREATE INDEX idx_events_timestamp ON events(timestamp);
```

### 7.2 事件投递表 (event_deliveries)

```sql
CREATE TABLE event_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id),
  agent_id VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- pending, delivered, failed, dead_letter
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 4,
  last_attempt_at TIMESTAMPTZ,
  response_status INT,
  response_body TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_deliveries_event ON event_deliveries(event_id);
CREATE INDEX idx_deliveries_agent ON event_deliveries(agent_id);
CREATE INDEX idx_deliveries_status ON event_deliveries(status);
```

### 7.3 Agent 订阅表 (agent_subscriptions)

```sql
CREATE TABLE agent_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_binding_id UUID REFERENCES agent_bindings(id),
  event_type VARCHAR(100) NOT NULL,
  webhook_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_binding_id, event_type)
);

CREATE INDEX idx_subscriptions_agent ON agent_subscriptions(agent_binding_id);
CREATE INDEX idx_subscriptions_type ON agent_subscriptions(event_type);
```

## 8. 实现组件

### 8.1 组件列表

| 组件 | 文件 | 说明 |
|------|------|------|
| Event Types | `src/events/types.ts` | 事件类型定义 |
| Event Publisher | `src/events/publisher.ts` | 事件发布器 |
| Event Subscriber | `src/events/subscriber.ts` | 事件订阅器 |
| Webhook Dispatcher | `src/events/webhook-dispatcher.ts` | Webhook 投递器 |
| Retry Queue | `src/events/retry-queue.ts` | 重试队列 |
| Event API | `src/app/api/events/route.ts` | 事件 API |
| Price Warning Service | `src/services/price-warning.ts` | 价格预警服务 |

## 9. 与现有系统集成

### 9.1 集成点

```
现有流程                    Event-Driven 增强
────────────────────────────────────────────────────
PR Created ──────────────▶ 发布 pr.created 事件
PR Submitted ─────────────▶ 发布 pr.submitted 事件
PR Approved ──────────────▶ 发布 pr.approved 事件
Quote Created ─────────────▶ 价格检查 → 可能触发 price.high
GR Created ────────────────▶ 发布 gr.created 事件
GR Overdelivery ──────────▶ 发布 gr.overdelivered 事件
Return GR Created ────────▶ 发布 gr.return_requested 事件
```

### 9.2 不破坏现有逻辑

- 所有事件发布都是**可选增强**
- 现有 API 逻辑不变
- 事件系统作为独立模块
