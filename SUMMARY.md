# 压缩摘要

## 用户需求与目标
- 原始目标: 创建基于React的采购管理系统，支持采购申请、寻源、框架协议、采购订单、收货等全流程管理
- 当前目标: 实现细粒度权限控制，解决飞书Bot无法主动联系用户的问题
- 验收标准与约束:
  - 使用 Next.js 16 + TypeScript + Zod
  - MCP Server 基于 @modelcontextprotocol/sdk 1.29.0
  - Agent角色注册后不可修改，Header不可伪造
- 权限控制要求:
  - **buyer**: 只能创建供应商、输入报价单，其余只能查看
  - **requester**: 只能输入采购申请、建立新物料、输入收货数量，其余只能查看
  - **manager**: 只能审批采购申请、审批超收，其余只能查看

## 项目概览
- 概述: 面向 Agent 的采购管理系统，支持采购申请、寻源、框架协议、采购订单、收货等全流程管理
- 技术栈:
  - Next.js 16
  - TypeScript 5
  - React 19
  - @modelcontextprotocol/sdk 1.29.0
  - Zod 4.3.6
- 编码规范:
  - Airbnb

## 关键决策
- 使用 MCP Server 暴露采购系统工具能力
- 寻源任务扩展：新增 pending 列表、详情查询、更新接口
- 权限控制：buyer/manager 可查看待寻源列表，仅 buyer 可更新
- 安全加固：X-Role 已禁用，Agent 角色由数据库管理，不可伪造
- 健康检查、限流、缓存层已实现
- 细粒度权限配置：创建统一的权限矩阵，统一管理 REST API 和 MCP 工具权限

## 本次迭代新增功能

### 1. Event-Driven Agent 协作架构

#### 设计文档
- **`EVENT_DRIVEN_DESIGN.md`** - 详细的架构设计文档

#### 核心实现
- **`src/events/types.ts`** - 事件类型定义（30+ 事件类型）
- **`src/events/publisher.ts`** - 事件发布器
- **`src/events/subscriber.ts`** - 事件订阅管理器
- **`src/events/webhook-dispatcher.ts`** - Webhook 投递器
- **`src/app/api/events/route.ts`** - 事件 API
- **`src/app/api/agent-bindings/[id]/subscriptions/route.ts`** - 订阅管理 API
- **`supabase/migrations/002_events_and_subscriptions.sql`** - 数据库迁移

#### 事件类型
- PR 事件: `pr.created`, `pr.submitted`, `pr.approved`, `pr.rejected`
- 寻源事件: `sourcing.created`, `sourcing.completed`, `sourcing.failed`
- 报价事件: `quote.created`, `quote.awarded`, `quote.rejected`
- PO 事件: `po.created`, `po.sent`, `po.received`, `po.cancelled`
- 收货事件: `gr.created`, `gr.completed`, `gr.overdelivered`, `gr.return_requested`, `gr.return_approved`
- 价格预警: `price.high`, `price.abnormal`

### 2. 退货审批流程

- **`src/app/api/goods-receipts/returns/route.ts`** - 退货审批 API
- Manager 可查看待审批退货列表
- Manager 可批准或拒绝退货申请
- 退货批准后自动更新 PO 行数量

### 3. 物料价格管理

- **`src/app/api/materials/[id]/price-history/route.ts`** - 历史价格查询 API
- **`src/app/api/materials/compare-price/route.ts`** - 多供应商比价 API
- **`src/services/price-warning.ts`** - 价格预警服务
  - 高于历史均价 10% 触发 `price.high` 事件
  - 价格波动超过 50% 触发 `price.abnormal` 事件

### 4. 审计日志增强

- **`src/app/api/audit-logs/route.ts`** - 审计日志 API 增强
- 支持按实体类型、实体 ID、操作类型过滤
- 支持查看单个实体的完整变更历史
- 支持审计统计（Manager only）

### 5. 数据统计分析

- **`src/app/api/statistics/route.ts`** - 统计分析 API
- 概览统计：PR/PO/GR/供应商/物料统计
- 趋势分析：按天/周/月统计指标变化

## 数据库迁移

执行 `supabase/migrations/002_events_and_subscriptions.sql` 创建：
- `events` 表 - 事件存储
- `event_deliveries` 表 - 事件投递记录
- `agent_subscriptions` 表 - Agent 订阅配置
- 触发器 - Agent 注册时自动创建默认订阅

## API 清单

| API | 方法 | 说明 |
|-----|------|------|
| `/api/events` | GET/POST | 事件查询和发布 |
| `/api/agent-bindings/{id}/subscriptions` | GET/PUT | 订阅管理 |
| `/api/goods-receipts/returns/pending` | GET | 待审批退货列表 |
| `/api/goods-receipts/returns/{id}/approve` | POST | 退货审批 |
| `/api/materials/{id}/price-history` | GET | 物料价格历史 |
| `/api/materials/compare-price` | GET | 多供应商比价 |
| `/api/audit-logs` | GET/POST | 审计日志查询 |
| `/api/audit-logs/statistics` | PUT | 审计统计 |
| `/api/statistics/overview` | GET | 概览统计 |
| `/api/statistics/trend` | POST | 趋势分析 |

## TODO
- [x] 创建细粒度权限配置文件 (src/lib/permissions.ts)
- [x] 实现 MCP 工具权限控制 (src/mcp/tool-policy.ts)
- [x] 实现 REST API 权限控制 (src/middleware/api-permission.ts)
- [x] 分析飞书 Bot 无法主动联系用户的原因
- [x] 实现 Event-Driven Agent 协作架构
- [x] 实现退货审批流程
- [x] 实现物料历史价格查询
- [x] 实现多供应商比价
- [x] 实现价格预警机制
- [x] 实现审计日志
- [x] 实现数据统计分析
- [ ] 集成飞书 SDK（需要飞书应用 credentials）
