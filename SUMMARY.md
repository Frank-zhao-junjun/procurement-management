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

## 核心文件修改
### 新建文件
- `src/lib/permissions.ts` - 细粒度权限配置文件（角色 × 资源 × 操作矩阵）
- `src/middleware/api-permission.ts` - REST API 权限控制中间件
- `src/mcp/tool-policy.ts` - MCP 工具权限控制（已重构，与权限配置对齐）
- `FEISHU_INTEGRATION.md` - 飞书 Bot 集成分析文档

### 修改文件
- `src/app/api/materials/route.ts` - 添加权限检查
- `src/app/api/purchase-requests/route.ts` - 添加权限检查
- `src/lib/api-key.ts` - 添加 getApiKeyRole 函数
- `AGENTS.md` - 更新角色权限说明（细粒度权限矩阵 + MCP 工具权限）

## 权限配置设计

### 核心文件：src/lib/permissions.ts
```typescript
// 权限矩阵定义
export const ROLE_PERMISSIONS = {
  buyer: {
    materials: { actions: ['list', 'get'], ... },
    suppliers: { actions: ['list', 'get', 'create'], ... },
    // ...
  },
  requester: { ... },
  manager: { ... },
};
```

### API 路径映射
```typescript
// REST API 路径到资源的映射
export const API_PATH_TO_RESOURCE = {
  'GET /api/materials': { resource: 'materials', action: 'list' },
  'POST /api/suppliers': { resource: 'suppliers', action: 'create' },
  // ...
};
```

## 飞书 Bot 无法主动联系用户的原因分析

### 问题根源
1. **缺少飞书 SDK 集成**：系统没有接入飞书开放平台，无法调用发送消息 API
2. **缺少用户标识映射**：`agentId` 没有映射到飞书 `open_id`
3. **缺少消息发送机制**：Webhook 只是通知外部服务，不是直接发消息

### 解决方案
1. 集成飞书 SDK（@larksuiteoapi/node-sdk）
2. 创建 `agent_feishu_mapping` 表维护映射
3. 在事件触发时调用飞书 API 发送消息

详细方案见 `FEISHU_INTEGRATION.md`

## TODO
- [x] 创建细粒度权限配置文件 (src/lib/permissions.ts)
- [x] 实现 MCP 工具权限控制 (src/mcp/tool-policy.ts)
- [x] 实现 REST API 权限控制 (src/middleware/api-permission.ts)
- [x] 分析飞书 Bot 无法主动联系用户的原因
- [ ] 集成飞书 SDK（需要飞书应用 credentials）
