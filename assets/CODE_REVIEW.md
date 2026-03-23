# 采购管理系统 - 完整代码审查报告

> 审查时间: 2025-03-23 | 技术栈: Next.js 16, React 19, TypeScript, Supabase, Drizzle

---

## 一、严重问题（P0 - 需立即修复）

### 1. 权限控制缺陷 - 采购订单列表

**文件**: `src/lib/role-filter.ts`

**问题**: `filterPurchaseOrders` 对 `requester` 和 `buyer` 均返回原 query 不做过滤，**需求人能看到所有采购订单**，违反「需求人只能看自己 PR 对应的 PO」的业务规则。

```typescript
// 当前实现 - 错误
case 'requester':
  return query;  // 未过滤
case 'buyer':
  return query;
```

**建议**: Requester 需通过子查询或 RPC 限定：仅返回与 `purchase_request_lines.request_id` 关联的 PR 中 `applicant === actor` 的 PO。

---

### 2. 权限控制缺陷 - 单个采购申请 GET

**文件**: `src/app/api/purchase-requests/[id]/route.ts`

**问题**: GET 单条采购申请时**未校验访问权限**。需求人可猜测 ID 查看他人申请。

**建议**: 返回前增加校验：若 `role === 'requester'` 且 `data.applicant !== actor`，返回 403。

---

### 3. 权限控制缺陷 - 采购申请提交

**文件**: `src/app/api/purchase-requests/[id]/submit/route.ts`

**问题**: 提交接口**未校验申请人身份**。任意用户可提交他人的草稿 PR。

**建议**: 增加 `existing.applicant === actor` 校验，仅申请人可提交自己的草稿。

---

### 4. 编号生成器 - FA 字段名错误（已修复）

**文件**: `src/storage/database/number-generator.ts`

**状态**: 已从 `'agreement_number'` 修正为 `'fa_number'`。

---

### 5. 物料 API - 列名映射（已修复）

**文件**: `src/app/api/materials/route.ts`

**状态**: 已增加 camelCase → snake_case 转换。

---

### 6. 飞书绑定 - Schema 与实现严重不一致

**文件**: `src/storage/database/feishu-binding.ts` vs `src/storage/database/shared/schema.ts`

**问题**: Drizzle schema 定义 `feishu_bindings` 列为 `feishu_open_id`, `feishu_app_id`, `agent_id`, `role`，而 feishu-binding.ts 使用 `feishu_user_id`, `feishu_union_id`, `entry` 等不存在的列名，插入/查询会失败。

| Schema (Drizzle) | feishu-binding.ts |
|------------------|-------------------|
| agent_id         | feishu_user_id    |
| feishu_app_id    | (未传)            |
| role             | entry             |
| -                | feishu_union_id   |

**建议**: 统一 schema 与实现，或通过迁移补齐缺失表结构。

---

### 7. 超收审批 - PO 行状态逻辑错误

**文件**: `src/app/api/goods-receipts/[id]/approve-overdelivery/route.ts`

**问题**: 审批通过时固定将 PO 行状态设为 `'received'`，未根据 `pending_qty` 判断。若订单 100 件、本次收货 10 件，应为 `partial_received` 而非 `received`。

```typescript
// 当前 - 错误
status: 'received',  // 应依据 pending_qty 动态计算
```

**建议**: 按 `pending_qty === 0` 判断，`true` 则为 `received`，否则为 `partial_received`。

---

### 8. confirm-fa - 字段名 camelCase 误用

**文件**: `src/app/api/purchase-request-lines/[id]/confirm-fa/route.ts`

**问题**: Supabase 返回 snake_case，代码使用 `prLine.expectedDeliveryDate` 会得到 `undefined`。正确应为 `prLine.expected_delivery_date`。

---

## 二、中等问题（P1 - 建议尽快修复）

### 9. 物料 PUT/DELETE - 安全与校验

**文件**: `src/app/api/materials/[id]/route.ts`

**问题**:
- 使用 `...body` 直接更新，无校验，可传任意字段
- 未校验角色（物料应由 buyer/manager 维护）
- 审计日志缺少 `actor_role`

---

### 10. 供应商 API - 同类问题

**文件**: `src/app/api/suppliers/route.ts`, `src/app/api/suppliers/[id]/route.ts`

**问题**:
- POST: `insertSupplierSchema` 产出 camelCase，直接 insert 可能列名不匹配（如 `isActive` → `is_active`）
- PUT: `...body` 无校验、无角色校验、审计缺少 `actor_role`
- DELETE: 无角色校验

---

### 11. 寻源任务 POST - 无角色与输入校验

**文件**: `src/app/api/sourcing-tasks/route.ts`

**问题**: 无 buyer/manager 角色校验，无 Zod 校验，`body.prId` 等可被伪造。

---

### 12. 报价单 POST - 无角色与输入校验

**文件**: `src/app/api/quotes/route.ts`

**问题**: 无 buyer/manager 角色校验，无必填项校验（如 `sourcingTaskId`, `supplierId`, `unitPrice`, `quantity`）。

---

### 13. 审计日志 actor_role 缺失

**文件**: `src/app/api/materials/[id]/route.ts`, `src/app/api/suppliers/[id]/route.ts`

**问题**: 部分审计 `insert` 未传 `actor_role`，与其余模块不一致。

---

### 14. 飞书绑定 API - 无认证

**文件**: `src/app/api/feishu-bindings/route.ts`

**问题**: GET/POST 均无认证，任何人可查询或创建绑定，存在越权风险。

---

## 三、轻微问题（P2 - 可选优化）

### 15. 身份识别可伪造

**文件**: `src/lib/role-filter.ts`

**问题**: `getUserIdentity` 完全依赖 `X-Actor`、`X-Role` 请求头，无服务端校验，客户端可伪造身份与角色。

---

### 16. 错误处理类型安全

**涉及**: 多数 API route

**问题**: `catch (error: any)` 与 `error.message` 类型不安全。

**建议**:
```typescript
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return NextResponse.json({ error: message }, { status: 500 });
}
```

---

### 17. po_line_number 赋值冗余（已修复）

**文件**: `src/app/api/purchase-orders/route.ts`

**状态**: 已移除多余三元表达式。

---

### 18. Drizzle 与 Supabase 双轨

**问题**: 存在 Drizzle schema，但全部 API 使用 Supabase Client，schema 与实现脱节，类型无法统一复用。

**建议**: 选其一（迁移到 Drizzle 或移除 Drizzle 配置）。

---

### 19. 缺失表定义

**问题**: `po_send_failures` 在 `po-sender.ts` 及 retry API 中使用，但 Drizzle schema 未定义，需确认 Supabase 迁移是否包含该表。

---

### 20. 环境变量命名不统一

**文件**: `supabase-client.ts` vs `drizzle.config.ts`

**问题**: `COZE_SUPABASE_URL` vs `DATABASE_URL` 易造成部署混淆。

---

### 21. package.json lint 命令

**问题**: `"lint": "eslint"` 未指定路径，建议补充如 `"lint": "next lint"` 或 `"eslint src"`。

---

## 四、前端与 AGENTS 规范

### 22. 硬编码测试身份

**文件**: `src/app/purchase-requests/page.tsx`, `src/app/purchase-requests/new/page.tsx`

**问题**: `purchaseRequestsApi.submit(id, 'agent:user')`、`approve(id, ..., 'agent:manager', 'manager')` 等硬编码身份，生产环境应基于登录态或飞书绑定。

---

### 23. Hydration 规范

**状态**: 当前页面使用 `useEffect` + `useState` 加载数据，符合 AGENTS.md 对动态内容的规范。未发现 `typeof window`、`Date.now()` 等在服务端渲染中的不当使用。

---

## 五、修复优先级汇总

| 优先级 | 问题编号 | 类型说明 |
|--------|----------|----------|
| **P0** | 1, 2, 3, 6, 7, 8 | 权限、数据正确性、关键流程 |
| **P1** | 9, 10, 11, 12, 13, 14 | 安全、校验、审计一致性 |
| **P2** | 15, 16, 18, 19, 20, 21, 22 | 类型安全、架构、配置 |

---

## 六、已修复项（本轮实施）

### P0
- [x] 采购订单列表 requester 权限过滤：新增 `getRequesterAccessiblePOIds`，requester 仅能看到自己 PR 对应的 PO
- [x] 单个采购申请 GET 权限校验：requester 仅能查看自己创建的申请
- [x] 采购申请提交申请人校验：仅申请人本人可提交自己的草稿
- [x] 超收审批 PO 行 status：按 `pending_qty` 正确计算 `received` / `partial_received`
- [x] confirm-fa `expected_delivery_date`：使用 Supabase 返回的 snake_case 字段名
- [x] 编号生成器 FA 字段、物料 POST 列名、po_line_number 冗余（此前已修）

### P1
- [x] 物料 PUT/DELETE：角色校验、Zod 校验、审计 `actor_role`
- [x] 供应商 POST：camelCase → snake_case 映射
- [x] 供应商 PUT/DELETE：角色校验、Zod 校验、审计 `actor_role`
- [x] 寻源任务 POST：角色校验、`insertSourcingTaskSchema` 校验
- [x] 报价单 POST：角色校验、`insertQuoteSchema` 校验

### 待后续处理
- [ ] 飞书绑定 schema 与实现不一致（需确认实际 DB 结构）
- [ ] 飞书绑定 API 认证
- [ ] 身份识别服务端校验（X-Actor/X-Role 可伪造）

---

*报告完毕。建议按 P0 → P1 → P2 顺序逐项修复。*
