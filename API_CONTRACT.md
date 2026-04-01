# API 契约规范

本文档定义了采购管理系统所有 API 的契约规范，包括参数格式、角色权限、数据类型、状态机定义。

---

## 1. 调用前自检清单

每次编写/修改 API 代码前，必须完成以下检查：

### 1.1 角色权限检查
```typescript
// ✅ 正确：先检查角色，再处理业务逻辑
if (!allowedRoles.includes(role)) {
  return NextResponse.json({ error: '无权限' }, { status: 403 });
}

// ❌ 错误：先执行业务，再检查权限（可能导致数据泄露）
const result = await process();
if (!allowedRoles.includes(role)) { ... }
```

### 1.2 参数校验检查
```typescript
// ✅ 正确：使用 schema 验证
const parsed = schema.safeParse(body);
if (!parsed.success) {
  return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
}

// ❌ 错误：直接使用 body 参数
const data = body.someField; // 可能为 undefined
```

### 1.3 数据库查询检查
```typescript
// ✅ 正确：查询后验证数据存在
const { data, error } = await client.from('table').select(...);
if (error) return NextResponse.json({ error }, { status: 500 });
if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

// ❌ 错误：假设查询一定成功
const { data } = await client.from('table').select(...);
return data.field; // 如果 data 为 null，直接报错
```

### 1.4 角色过滤检查
```typescript
// ✅ 正确：明确每个角色能看到什么
function filterData(query, role, actor) {
  switch (role) {
    case 'requester':
      return query.eq('applicant', actor);  // 只能看自己的
    case 'buyer':
      return query;  // 可以看所有
    case 'manager':
      return query;  // 可以看所有
    default:
      return query.eq('id', -1);  // 未知角色返回空
  }
}

// ❌ 错误：使用 id=-1 作为占位符（PostgREST 不支持）
return query.eq('id', -1);  // 这会返回 id=1 的记录！
```

---

## 2. 角色权限矩阵

### 2.1 数据可见性规则

| 实体 | requester | buyer | manager |
|------|-----------|-------|---------|
| **采购申请 (PR)** | 看自己的 | 看所有 | 看所有 |
| **PR 行** | 看自己的 | 看所有 | 看所有 |
| **寻源任务** | 看自己PR关联的 | 看所有 | 看所有 |
| **报价单** | ❌ 不可见 | 看所有 | ❌ 不可见 |
| **框架协议** | 看所有 | 看所有 | 看所有 |
| **采购订单 (PO)** | 看自己PR关联的 | 看所有 | 看所有 |
| **收货单 (GR)** | 看自己创建的 | 看所有 | 看所有 |
| **物料** | 看所有 | 看所有 | 看所有 |
| **供应商** | 看所有 | 看所有 | 看所有 |
| **审计日志** | 看自己的 | 看自己的 | 看所有 |

### 2.2 创建权限

| 操作 | requester | buyer | manager |
|------|-----------|-------|---------|
| 创建 PR | ✅ | ✅ | ✅ |
| 提交 PR | ✅ (自己的) | ✅ | ❌ |
| 审批 PR | ❌ | ❌ | ✅ |
| 创建寻源任务 | ❌ | ✅ | ❌ |
| 创建报价单 | ❌ | ✅ | ❌ |
| 授标报价单 | ❌ | ✅ | ❌ |
| 创建 PO | ❌ | ✅ | ❌ |
| 发送 PO | ❌ | ✅ | ❌ |
| 创建收货单 | ❌ | ✅ | ❌ |
| 审批超收 | ❌ | ❌ | ✅ |
| 创建物料 | ❌ | ✅ | ✅ |
| 创建供应商 | ❌ | ✅ | ✅ |

---

## 3. 参数命名规范

### 3.1 统一使用驼峰命名

```typescript
// ✅ 正确：统一使用驼峰命名
{
  "prId": 1,
  "poLineId": 2,
  "unitPrice": 100.50,
  "expectedDeliveryDate": "2025-04-15"
}

// ❌ 错误：混用下划线和驼峰
{
  "pr_id": 1,      // 不要用下划线
  "poLineId": 2,   // 混用
  "unit_price": 100.50  // 不要用下划线
}
```

### 3.2 参数别名处理

如果需要兼容旧参数，在代码中显式处理：

```typescript
// ✅ 正确：显式处理参数别名
const prId = body.prId ?? body.pr_id ?? body['pr-id'];
const poLineId = body.poLineId ?? body.po_line_id ?? body['po-line-id'];

// ❌ 错误：没有处理别名
const prId = body.prId; // 如果前端传 pr_id 就获取不到
```

### 3.3 实体参数命名对照表

| 实体 | ID 参数 | 别名 | 说明 |
|------|---------|------|------|
| 采购申请 | `prId` | `pr_id`, `requestId` | |
| 采购申请行 | `prLineId` | `pr_line_id`, `lineId` | |
| 采购订单 | `poId` | `po_id`, `orderId` | |
| 采购订单行 | `poLineId` | `po_line_id` | 收货时使用 |
| 寻源任务 | `sourcingTaskId` | `scId`, `taskId` | |
| 报价单 | `quoteId` | `quote_id` | |
| 框架协议 | `faId` | `fa_id`, `protocolId` | |
| 物料 | `materialId` | `material_id`, `itemId` | |
| 供应商 | `supplierId` | `supplier_id` | |

---

## 3.4 Agent 高层动作接口

当调用方主要是 Agent 时，优先提供“业务动作”接口，而不是要求 Agent 组合多个底层 CRUD API。

### 设计原则

- 一个动作接口完成一个业务目标
- 服务端负责串联校验、状态流转、审计和事件发布
- 保留底层资源接口，供 UI 查询或需要细粒度控制的场景使用

### 推荐高层动作接口

| 接口 | 说明 | 典型调用方 |
|------|------|-----------|
| `POST /api/agent-actions/create-pr-from-material-check` | 检查物料、必要时自动补充确认并创建 PR，可选自动提交 | requester / buyer agent |
| `POST /api/agent-actions/approve-pr-and-handle-fa` | 审批 PR，并自动执行 FA 匹配/寻源/自动建 PO | manager agent |
| `POST /api/agent-actions/create-po-from-awarded-quote` | 授标报价单并自动创建 PO | buyer agent |
| `POST /api/agent-actions/confirm-fa-and-create-po` | 确认或拒绝 FA 匹配，必要时自动建 PO 或创建寻源任务 | buyer agent |
| `POST /api/agent-actions/receive-goods-and-handle-overdelivery` | 创建收货单，并在超收时自动返回待审批结果 | buyer / manager agent |
| `POST /api/agent-actions/submit-contract-for-approval` | 提交框架协议进入审批并通知 manager | buyer / manager agent |
| `POST /api/agent-actions/submit-pr` | 提交已创建的采购申请进入审批流 | requester / buyer agent |
| `POST /api/agent-actions/approve-overdelivery` | 审批超收收货单 | manager agent |
| `GET /api/agent-actions/manifest` | 返回动作清单、用途、幂等支持与输入字段定义 | all agents |

### 错误处理约定

```typescript
// ✅ 动作接口应返回统一 envelope，而不是只返回单表写入结果
{
  "success": true,
  "action": "create-po-from-awarded-quote",
  "data": {
    "purchaseOrder": {...},
    "quote": {...}
  },
  "nextActions": [
    {
      "action": "receive-goods-and-handle-overdelivery",
      "reason": "PO 已生成，可继续执行收货",
      "suggestedPayload": {
        "poLineId": 1,
        "quantity": 10
      }
    }
  ],
  "warnings": [],
  "statusCode": 200
}

// ✅ 对需要 Agent 决策的场景，放在 data 内返回明确状态，而非直接失败
{
  "success": true,
  "action": "create-pr-from-material-check",
  "data": {
    "created": false,
    "requiresConfirmation": true,
    "unresolvedLines": [...]
  },
  "nextActions": [...],
  "warnings": [...]
}
```

### 幂等约定

Agent 高层动作接口应支持以下任一幂等键来源：

- 请求头：`Idempotency-Key`
- 请求体：`requestId`

同一 `actor + action + idempotency key` 的重复请求，应直接返回上次成功结果，避免重复建单、重复提交、重复收货。

### 写入一致性约定

- 对关键多表动作（如 PR 创建、PO 创建、FA 确认建 PO、收货）应执行写后校验
- 只有在 header / lines 等关键记录都验证存在后，才允许返回 `success: true`
- 如果 header 已创建但 lines 校验失败，服务端应补偿删除已写入 header，避免出现“表头成功、行项目失败但仍返回成功”的半成功状态
- 因此，Agent 不应再仅以“拿到单据号”判断成功，而应以接口返回的 `success=true` 且 `data` 中关键实体存在为准

---

## 4. 数据类型规范

### 4.1 数据库类型到 API 类型的映射

| PostgreSQL 类型 | JavaScript/JSON 类型 | 示例 |
|-----------------|---------------------|------|
| `SERIAL` / `INT` | `number` | `{"id": 1}` |
| `DECIMAL(N,M)` / `NUMERIC` | `number` (字符串也可) | `{"unitPrice": "100.50"}` 或 `100.50` |
| `VARCHAR` | `string` | `{"name": "测试"}` |
| `TEXT` | `string` | `{"description": "..."}` |
| `BOOLEAN` | `boolean` | `{"isActive": true}` |
| `DATE` | `string` (YYYY-MM-DD) | `{"date": "2025-04-01"}` |
| `TIMESTAMP` | `string` (ISO 8601) | `{"createdAt": "2025-04-01T10:00:00+08:00"}` |
| `JSONB` | `object` / `array` | `{"metadata": {...}}` |
| `UUID` | `string` | `{"uuid": "550e8400-e29b..."}` |

### 4.2 数字类型处理

```typescript
// ✅ 正确：统一转为数字或字符串
const unitPrice = Number(body.unitPrice ?? body.unit_price);
if (isNaN(unitPrice) || unitPrice < 0) {
  return NextResponse.json({ error: 'unitPrice 必须是非负数' }, { status: 400 });
}

// ✅ 也支持字符串形式的数字
const quantity = parseFloat(body.quantity);
if (isNaN(quantity) || quantity <= 0) {
  return NextResponse.json({ error: 'quantity 必须是正数' }, { status: 400 });
}
```

### 4.3 日期时间规范

```typescript
// ✅ 正确：使用北京时间
function getBeijingDateString(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// ✅ 时间格式
function getBeijingTimeString(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}
```

---

## 5. 状态机定义

### 5.1 采购申请 (PR) 状态

```
draft → pending → approved
              ↓       ↓
           rejected  (自动处理)
```

| 状态 | 说明 | 可转换到 |
|------|------|---------|
| `draft` | 草稿 | `pending` |
| `pending` | 待审批 | `approved`, `rejected` |
| `approved` | 已批准 | - |
| `rejected` | 已拒绝 | - |

### 5.2 采购申请行 (PR Line) 进度

```
pending → approved → matched_protocol → sourced → ordered → received → completed
                    ↓
              pending_confirm (需确认FA)
```

| 进度 | 说明 |
|------|------|
| `pending` | 待处理 |
| `approved` | 已批准 |
| `matched_protocol` | 已匹配框架协议 |
| `pending_confirm` | 待确认FA匹配 |
| `sourced` | 已寻源 |
| `ordered` | 已下单 |
| `received` | 已收货 |
| `completed` | 已完成 |

### 5.3 采购订单 (PO) 状态

```
draft → sent → acknowledged → partially_received → received → completed
                ↓
            rejected
```

| 状态 | 说明 | 可转换到 |
|------|------|---------|
| `draft` | 草稿（手动创建） | `sent` |
| `sent` | 已发送（框架协议匹配自动创建） | `acknowledged`, `rejected` |
| `acknowledged` | 供应商已确认 | `partially_received` |
| `partially_received` | 部分收货 | `received` |
| `received` | 已完成收货 | - |
| `rejected` | 供应商拒绝 | - |

### 5.4 寻源任务状态

```
pending → in_progress → completed → cancelled
```

### 5.5 收货单状态

```
pending → completed → overdelivery_pending → approved
```

| 状态 | 说明 |
|------|------|
| `pending` | 待处理 |
| `completed` | 正常收货完成 |
| `overdelivery_pending` | 超收待审批 |
| `approved` | 超收已审批 |

---

## 6. API 响应格式

### 6.1 成功响应

```typescript
// ✅ 统一格式
return NextResponse.json({
  data: { /* 业务数据 */ },
  total: 10,       // 列表时返回总数
  page: 1,         // 列表时返回页码
  pageSize: 20,    // 列表时返回页大小
});
```

### 6.2 错误响应

```typescript
// ✅ 统一格式
return NextResponse.json({
  error: '错误描述',
  code: 'ERROR_CODE',        // 可选：错误码
  details: { /* 详细信息 */ } // 可选：调试信息
}, { status: 400 });
```

### 6.3 HTTP 状态码使用

| 状态码 | 使用场景 |
|--------|---------|
| `200` | 成功查询、更新 |
| `201` | 成功创建 |
| `204` | 成功删除（无返回体） |
| `400` | 参数错误、验证失败 |
| `401` | 未认证 |
| `403` | 无权限 |
| `404` | 资源不存在 |
| `409` | 状态冲突（如重复创建） |
| `500` | 服务器内部错误 |

---

## 7. 测试用例模板

### 7.1 创建操作测试

```bash
# 1. 验证参数校验
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{}' http://localhost:5000/api/xxx | jq '.error'

# 2. 验证角色权限（requester 无权创建）
curl -s -X POST -H 'Content-Type: application/json' \
  -H 'X-Actor: user1' -H 'X-Role: requester' \
  -d '{...}' http://localhost:5000/api/xxx | jq '.error'

# 3. 验证创建成功
curl -s -X POST -H 'Content-Type: application/json' \
  -H 'X-Actor: user1' -H 'X-Role: buyer' \
  -d '{...}' http://localhost:5000/api/xxx | jq '.data.id'

# 4. 验证数据持久化（立即查询）
ID=$(curl -s -X POST ... | jq -r '.data.id')
curl -s -H 'X-Actor: user1' -H 'X-Role: buyer' \
  "http://localhost:5000/api/xxx/${ID}" | jq '.data'
```

### 7.2 查询操作测试

```bash
# 1. 验证角色可见性
for role in requester buyer manager; do
  echo "Testing role: $role"
  curl -s -H "X-Actor: user1" -H "X-Role: $role" \
    http://localhost:5000/api/xxx | jq '.total'
done

# 2. 验证数据关联（requester 只能看自己的）
curl -s -H 'X-Actor: user1' -H 'X-Role: requester' \
  http://localhost:5000/api/xxx | jq '.data[].owner'
```

### 7.3 冒烟测试清单

每个 API 必须通过的测试：

```
[ ] 1. GET 列表 - buyer 角色能看到数据
[ ] 2. GET 列表 - manager 角色能看到数据  
[ ] 3. GET 列表 - requester 角色有正确的过滤
[ ] 4. POST 创建 - buyer 角色创建成功
[ ] 5. POST 创建 - requester 角色返回 403
[ ] 6. POST 创建 - 无效参数返回 400
[ ] 7. POST 创建后立即 GET - 数据存在
[ ] 8. PUT 更新 - 状态机正确转换
[ ] 9. DELETE - 数据被删除
```

---

## 8. 代码检查清单

编写完 API 后，自查以下问题：

### 8.1 参数处理
- [ ] 所有请求参数都有默认值或校验？
- [ ] 支持参数别名（驼峰和下划线）？
- [ ] 数字类型做了 `Number()` 或 `parseFloat()` 转换？
- [ ] 日期格式正确（YYYY-MM-DD）？

### 8.2 权限控制
- [ ] 创建操作检查了角色权限？
- [ ] 查询操作使用了 `filterXxx()` 函数？
- [ ] 每个角色的过滤逻辑明确且正确？

### 8.3 数据库操作
- [ ] 插入后验证 `error`？
- [ ] 查询后验证 `data` 存在？
- [ ] 使用服务角色客户端绕过 RLS（如果需要）？

### 8.4 状态机
- [ ] 状态转换前验证当前状态？
- [ ] 状态转换有审计日志？

### 8.5 测试
- [ ] 所有角色都测试过查询？
- [ ] 创建后立即查询验证持久化？
- [ ] 无效参数测试过？

---

## 9. 常见错误模式

### 9.1 ❌ 错误：使用 PostgREST 不支持的操作

```typescript
// ❌ 错误
query = query.eq('id', -1);  // 返回 id=1 的记录！

// ✅ 正确
query = query.eq('id', 0);   // 返回空
query = query.neq('id', 0);   // 返回所有（当 id > 0 时）
```

### 9.2 ❌ 错误：参数未校验就使用

```typescript
// ❌ 错误
const prId = body.prId;
await client.from('pr_lines').select().eq('request_id', prId);
// 如果 body.prId 是 undefined，查询会失败

// ✅ 正确
const prId = body.prId;
if (!prId) return NextResponse.json({ error: 'prId is required' }, { status: 400 });
```

### 9.3 ❌ 错误：状态机验证缺失

```typescript
// ❌ 错误
await client.from('po').update({ status: 'sent' }).eq('id', id);
// 任何状态都能被改成 sent

// ✅ 正确
const { data: po } = await client.from('po').select().eq('id', id).single();
if (po.status !== 'draft') {
  return NextResponse.json({ error: '只能发送草稿状态的订单' }, { status: 400 });
}
```

---

## 10. 调试命令

```bash
# 查看服务状态
ss -tuln | grep :5000

# 测试角色可见性
curl -s -H 'X-Actor: user1' -H 'X-Role: buyer' http://localhost:5000/api/xxx
curl -s -H 'X-Actor: user1' -H 'X-Role: manager' http://localhost:5000/api/xxx
curl -s -H 'X-Actor: user1' -H 'X-Role: requester' http://localhost:5000/api/xxx

# 验证数据持久化
ID=$(curl -s -X POST ... | jq -r '.data.id')
curl -s "http://localhost:5000/api/xxx/${ID}"

# 类型检查
npx tsc --noEmit

# 日志检查
tail -n 50 /app/work/logs/bypass/app.log | grep -iE "error|warn"
```
