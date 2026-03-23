# Agent 使用指南

本系统面向 Agent 设计，支持通过 HTTP API 进行全流程采购管理。

## 身份识别

Agent 通过请求头传递身份信息：

| 请求头 | 说明 | 可选值 |
|--------|------|--------|
| `X-Actor` | 身份标识 | `agent:user123`, `manager`, `buyer` 等 |
| `X-Role` | 角色 | `requester`, `buyer`, `manager` |

```bash
curl -H "X-Actor: agent:user123" -H "X-Role: requester" ...
```

## 角色权限

| 角色 | 可创建 | 可查看 | 可审批 |
|------|--------|--------|--------|
| `requester` | PR | 自己PR对应数据 | - |
| `buyer` | PO, Quote, SC, FA | 所有采购数据 | - |
| `manager` | - | 所有数据 | PR, 超收收货 |

## 完整业务流程

### 1. 采购申请 (PR)

```bash
# 创建 PR
POST /api/purchase-requests
{
  "reason": "产线急需M3螺栓500个",
  "lines": [
    {"requirementText": "M3螺栓", "quantity": 500, "expectedDeliveryDate": "2025-04-15"}
  ]
}

# 提交 PR
POST /api/purchase-requests/{id}/submit

# Manager 审批
POST /api/purchase-requests/{id}/approve
{"approved": true}
```

### 2. 框架协议匹配

审批通过后，系统自动匹配框架协议：
- 状态设为 `pending_confirm`（待确认，非静默）
- 返回 Top-3 候选方案

```bash
# 查询匹配结果
GET /api/purchase-request-lines/{id}/match?topN=3

# 确认 FA 匹配
PUT /api/purchase-request-lines/{id}/confirm-fa
{"faId": 1, "confirmed": true}

# 拒绝并创建寻源任务
PUT /api/purchase-request-lines/{id}/confirm-fa
{"confirmed": false}
```

### 3. 寻源与报价

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

### 4. 采购订单 (PO)

```bash
# 创建 PO
POST /api/purchase-orders
{
  "supplierId": 1,
  "lines": [
    {"prLineId": 1, "quantity": 500, "unitPrice": 0.045}
  ]
}

# 发送 PO（支持失败重试）
POST /api/purchase-orders/{id}/send

# 重试发送（3次：1min间隔）
POST /api/purchase-orders/{id}/retry
```

### 5. 收货与超收

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

### 6. 飞书绑定

```bash
# 自助绑定（无需工号邮箱）
POST /api/feishu-bindings
{"feishuUserId": "ou_xxx", "entry": "requester"}

# 获取绑定状态
GET /api/feishu-bindings?feishuUserId=ou_xxx
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

## 审计日志

所有关键操作均记录审计日志：

```bash
# 查看审计日志（Manager 可看全部，其他人只看自己）
GET /api/audit-logs
GET /api/audit-logs?entityType=purchase_request&entityId=1
```

## 错误处理

| 状态码 | 说明 |
|--------|------|
| 400 | 请求参数错误 |
| 403 | 无权限操作 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

## 敏感接口权限

| 接口 | 权限要求 |
|------|----------|
| `GET /api/goods-receipts/pending-approval` | Manager only |
| `GET /api/audit-logs` | Manager 看全部，其他人看自己 |
| `POST /api/materials` | Buyer/Manager |
| `POST /api/suppliers` | Buyer/Manager |
| `GET /api/purchase-orders/{id}` | Requester 只能看自己PR对应的PO |
