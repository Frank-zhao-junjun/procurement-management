# Procurement Management System

面向 Agent 使用的采购管理系统，支持采购申请、寻源、报价、框架协议、采购订单、收货等全流程管理。

## 功能特性

- **采购申请 (PR)**: 创建、提交、审批
- **寻源任务 (SC)**: 供应商寻源管理
- **报价单 (Q)**: 单一中标报价管理
- **框架协议 (FA)**: 价格协议管理，支持自动匹配
- **采购订单 (PO)**: 订单创建、发送、状态跟踪
- **收货单 (GR/RT)**: 收货与退货管理，含超收审批
- **审计日志**: 完整操作追溯
- **飞书集成**: 三入口绑定、通知推送

## 技术栈

- **框架**: Next.js 16 (App Router)
- **UI**: React 19 + shadcn/ui + Tailwind CSS 4
- **数据库**: PostgreSQL (Supabase)
- **ORM**: Drizzle
- **语言**: TypeScript 5
- **包管理**: pnpm

## 快速开始

### 环境要求

- Node.js 18+
- pnpm 9+
- PostgreSQL (本地或 Supabase)

### 安装依赖

```bash
pnpm install
```

### 配置环境变量

创建 `.env.local` 文件：

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
FEISHU_WEBHOOK_URL=your_feishu_webhook_url
FEISHU_APP_ID=your_feishu_app_id
FEISHU_APP_SECRET=your_feishu_app_secret
```

### 开发环境

```bash
pnpm dev
```

访问 [http://localhost:5000](http://localhost:5000)

### 生产构建

```bash
pnpm build
pnpm start
```

## API 调用示例

Agent 可通过 HTTP API 调用系统：

```bash
# 创建采购申请
curl -X POST http://localhost:5000/api/purchase-requests \
  -H "Content-Type: application/json" \
  -H "X-Actor: agent:user" \
  -H "X-Role: requester" \
  -d '{"reason":"产线急需M3螺栓500个","lines":[{"requirementText":"M3螺栓","quantity":500}]}'

# 提交采购申请
curl -X POST http://localhost:5000/api/purchase-requests/{id}/submit \
  -H "X-Actor: agent:user" \
  -H "X-Role: requester"

# 审批采购申请 (Manager)
curl -X POST http://localhost:5000/api/purchase-requests/{id}/approve \
  -H "Content-Type: application/json" \
  -H "X-Actor: manager" \
  -H "X-Role: manager" \
  -d '{"approved": true}'

# 创建采购订单
curl -X POST http://localhost:5000/api/purchase-orders \
  -H "Content-Type: application/json" \
  -H "X-Actor: buyer" \
  -H "X-Role: buyer" \
  -d '{"supplierId":1,"lines":[{"prLineId":1,"quantity":500,"unitPrice":0.048}]}'

# 收货（超收 5% 需 Manager 审批）
curl -X POST http://localhost:5000/api/goods-receipts \
  -H "Content-Type: application/json" \
  -H "X-Actor: requester" \
  -H "X-Role: requester" \
  -d '{"poLineId":1,"quantity":105}'

# 飞书绑定
curl -X POST http://localhost:5000/api/feishu-bindings \
  -H "Content-Type: application/json" \
  -d '{"feishuUserId":"ou_xxx","entry":"requester"}'
```

## 角色权限

| 角色 | 说明 |
|------|------|
| `requester` | 需求人，可创建采购申请、查看自己PR对应PO、收货 |
| `buyer` | 采购人，可创建PO、报价、寻源任务、框架协议 |
| `manager` | 审批人，可审批PR和超收收货 |

## 项目结构

```
src/
├── app/
│   ├── api/                  # API 路由
│   │   ├── materials/
│   │   ├── suppliers/
│   │   ├── purchase-requests/
│   │   ├── purchase-request-lines/
│   │   ├── purchase-orders/
│   │   ├── goods-receipts/
│   │   ├── framework-agreements/
│   │   ├── sourcing-tasks/
│   │   ├── quotes/
│   │   ├── audit-logs/
│   │   └── feishu-bindings/
│   ├── page.tsx              # 首页仪表盘
│   └── ...                   # 页面路由
├── components/
│   └── ui/                   # shadcn/ui 组件
├── lib/
│   ├── api.ts                # API 客户端
│   └── role-filter.ts        # 角色权限过滤
└── storage/
    └── database/
        ├── schema.ts         # Drizzle 数据库 Schema
        ├── supabase-client.ts # Supabase 客户端
        ├── number-generator.ts  # 单据编号生成（上海时区+99上限）
        ├── fa-matcher.ts       # FA 智能匹配
        ├── po-sender.ts        # PO 发送与重试
        ├── feishu-binding.ts   # 飞书绑定
        └── feishu-notification.ts # 飞书通知
```

## 数据库表结构

- `materials` - 物料主数据
- `suppliers` - 供应商主数据
- `purchase_requests` - 采购申请
- `purchase_request_lines` - 采购申请行
- `sourcing_tasks` - 寻源任务
- `quotes` - 报价单
- `framework_agreements` - 框架协议
- `purchase_orders` - 采购订单
- `purchase_order_lines` - 采购订单行
- `goods_receipts` - 收货单
- `audit_logs` - 审计日志
- `feishu_bindings` - 飞书绑定
- `feishu_notifications` - 飞书通知队列
- `po_send_failures` - PO 发送失败记录

## 飞书集成配置

### Webhook 模式（简单）

```env
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx
```

### 应用身份模式（完整）

```env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
```

## License

MIT
