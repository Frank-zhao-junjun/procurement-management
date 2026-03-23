# 采购管理系统 (Procurement Management System)

面向 Agent 使用的全流程采购管理系统，支持采购申请、寻源、报价、框架协议、采购订单、收货等核心功能。

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

### 3. 数据库迁移

```bash
# 创建 agent_bindings 表
psql $DATABASE_URL < drizzle/0001_agent_bindings.sql
```

### 4. 启动开发服务器

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

# 创建采购申请
POST /api/purchase-requests
-H "X-Actor: my-agent"
{"reason": "采购M3螺栓", "lines": [...]}
```

## 核心功能

- 采购申请 (PR) - 创建、提交、审批
- 框架协议 (FA) - 自动匹配、手动确认
- 寻源任务 (SC) - 供应商询价
- 报价单 (Quote) - 多供应商竞价
- 采购订单 (PO) - 生成、发送、重试
- 收货单 (GR) - 标准收货、超收审批、退货
- 审计日志 - 全操作记录

## 文档

- [Agent 使用指南](AGENTS.md)
- [Agent 绑定实现](docs/AGENT_BINDING.md)
- [待完成设计](DESIGN_PENDING.md)
- [贡献指南](CONTRIBUTING.md)

## License

MIT
