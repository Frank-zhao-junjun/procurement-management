'use client';

import { useEffect, useState } from 'react';
import { purchaseRequestsApi, purchaseOrdersApi, suppliersApi, materialsApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface DashboardStats {
  totalPRs: number;
  pendingPRs: number;
  approvedPRs: number;
  totalPOs: number;
  pendingPOs: number;
  totalSuppliers: number;
  totalMaterials: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalPRs: 0,
    pendingPRs: 0,
    approvedPRs: 0,
    totalPOs: 0,
    pendingPOs: 0,
    totalSuppliers: 0,
    totalMaterials: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const [prs, pos, suppliers, materials] = await Promise.all([
          purchaseRequestsApi.list({ pageSize: 1 }),
          purchaseOrdersApi.list({ pageSize: 1 }),
          suppliersApi.list({ pageSize: 1 }),
          materialsApi.list({ pageSize: 1 }),
        ]);

        const pendingPRs = await purchaseRequestsApi.list({ status: 'submitted', pageSize: 1 });
        const approvedPRs = await purchaseRequestsApi.list({ status: 'approved', pageSize: 1 });
        const pendingPOs = await purchaseOrdersApi.list({ status: 'sent', pageSize: 1 });

        setStats({
          totalPRs: prs.total || 0,
          pendingPRs: pendingPRs.total || 0,
          approvedPRs: approvedPRs.total || 0,
          totalPOs: pos.total || 0,
          pendingPOs: pendingPOs.total || 0,
          totalSuppliers: suppliers.total || 0,
          totalMaterials: materials.total || 0,
        });
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">仪表盘</h1>
        <p className="text-gray-500 mt-1">采购管理系统概览</p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">采购申请</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalPRs}</div>
            <p className="text-xs text-gray-500 mt-1">总计</p>
            <div className="flex gap-2 mt-2">
              <Badge variant="secondary">{stats.pendingPRs} 待审批</Badge>
              <Badge variant="default">{stats.approvedPRs} 已批准</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">采购订单</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalPOs}</div>
            <p className="text-xs text-gray-500 mt-1">总计</p>
            <div className="flex gap-2 mt-2">
              <Badge variant="secondary">{stats.pendingPOs} 待发货</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">供应商</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalSuppliers}</div>
            <p className="text-xs text-gray-500 mt-1">已注册供应商</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">物料</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalMaterials}</div>
            <p className="text-xs text-gray-500 mt-1">已注册物料</p>
          </CardContent>
        </Card>
      </div>

      {/* 快速操作 */}
      <Card>
        <CardHeader>
          <CardTitle>快速操作</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <QuickAction
              title="新建采购申请"
              href="/purchase-requests/new"
              icon="📝"
            />
            <QuickAction
              title="新建采购订单"
              href="/purchase-orders/new"
              icon="📋"
            />
            <QuickAction
              title="添加供应商"
              href="/suppliers/new"
              icon="🏢"
            />
            <QuickAction
              title="添加物料"
              href="/materials/new"
              icon="📦"
            />
          </div>
        </CardContent>
      </Card>

      {/* Agent 指引 */}
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-blue-800 flex items-center gap-2">
            <span>🤖</span> Agent 使用完整指引 (§9)
          </CardTitle>
          <p className="text-xs text-blue-600 mt-1">共 9 条核心指引，覆盖身份、全流程、飞书绑定</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 text-sm">
            <div className="flex items-start gap-3 p-3 bg-white rounded-lg shadow-sm">
              <span className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
              <div>
                <p className="font-semibold text-gray-900">身份识别与权限 (§2.3)</p>
                <p className="text-gray-600 mt-1">通过请求头传递身份：<code className="bg-gray-100 px-1 rounded">X-Actor: agent:user</code>（身份标识）和 <code className="bg-gray-100 px-1 rounded">X-Role: requester|manager|buyer</code>（角色）。需求人仅看自己的 PR，采购人可操作 PO/报价，Manager 可审批 PR 和超收。</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-white rounded-lg shadow-sm">
              <span className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
              <div>
                <p className="font-semibold text-gray-900">采购申请全流程 (§3.1, §4.1)</p>
                <p className="text-gray-600 mt-1">创建 PR → 提交（POST /api/purchase-requests/[id]/submit）→ Manager 审批 → 系统自动匹配框架协议（上海时区有效期+最低价）→ 用户确认 FA 或拒绝 → 拒绝则自动创建寻源任务（SC）。</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-white rounded-lg shadow-sm">
              <span className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
              <div>
                <p className="font-semibold text-gray-900">寻源与报价 (§3.2, §3.3)</p>
                <p className="text-gray-600 mt-1">寻源任务（SC）→ 录入多个报价单（Q-XXXXXX 编号）→ 授标（单一中标）→ 确认后创建 PO。报价可关联物料/供应商，支持价格有效期。</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-white rounded-lg shadow-sm">
              <span className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0">4</span>
              <div>
                <p className="font-semibold text-gray-900">采购订单与发送 (§3.5, 决策34)</p>
                <p className="text-gray-600 mt-1">PO 创建后通过 <code className="bg-gray-100 px-1 rounded">POST /api/purchase-orders/[id]/send</code> 发送。发送失败自动进入重试队列（3次：1min/5min/10min），可调用 <code className="bg-gray-100 px-1 rounded">POST /api/purchase-orders/[id]/retry</code> 显式重试。</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-white rounded-lg shadow-sm">
              <span className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0">5</span>
              <div>
                <p className="font-semibold text-gray-900">收货与超收 (§3.6, §4.2)</p>
                <p className="text-gray-600 mt-1">收货数量超过订单 5% 且非 Manager 操作时，进入待审批状态（pending_approval）。Manager 通过 <code className="bg-gray-100 px-1 rounded">POST /api/goods-receipts/[id]/approve-overdelivery</code> 审批。退货使用 gr_type=out，自动回冲净收货数量。</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-white rounded-lg shadow-sm">
              <span className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0">6</span>
              <div>
                <p className="font-semibold text-gray-900">审计日志与追溯 (§8.3)</p>
                <p className="text-gray-600 mt-1">所有关键操作（创建/提交/审批/发送/收货/超收审批）自动记录审计日志，包含操作者身份、角色、时间戳、变更详情。可通过 <code className="bg-gray-100 px-1 rounded">GET /api/audit-logs</code> 查询。</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-white rounded-lg shadow-sm">
              <span className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0">7</span>
              <div>
                <p className="font-semibold text-gray-900">编号规则与防重 (§6, 决策35)</p>
                <p className="text-gray-600 mt-1">所有单据使用 Asia/Shanghai 时区，日流水号 01-99，第 100 次操作返回错误。前缀规则：PR-/SC-/Q-/FA-/PO-/GR-/RT-（退货）。报价单使用 Q-XXXXXX 全局序号。</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-white rounded-lg shadow-sm">
              <span className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0">8</span>
              <div>
                <p className="font-semibold text-gray-900">飞书三入口与绑定 (§2.5, 决策38)</p>
                <p className="text-gray-600 mt-1">支持三种飞书入口：工作台/机器人/消息链接。Agent 通过 <code className="bg-gray-100 px-1 rounded">POST /api/feishu-bindings</code> 自助绑定（无需工号邮箱）。用户数据隔离：requester 角色只看自己提交的单据。</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-white rounded-lg shadow-sm">
              <span className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0">9</span>
              <div>
                <p className="font-semibold text-gray-900">口语化识别与用户确认 (§5.1.1)</p>
                <p className="text-gray-600 mt-1">FA 匹配后状态为 pending_confirm，不再静默自动确认。系统返回 Top-3 候选方案（审计日志备查），Agent 展示给用户确认。拒绝 FA 自动创建寻源任务。</p>
              </div>
            </div>
          </div>
          
          {/* API 调用示例 */}
          <div className="mt-6 p-4 bg-slate-800 rounded-lg text-slate-100 text-xs font-mono overflow-x-auto">
            <p className="text-slate-400 mb-2">{'// Agent 调用示例'}</p>
            <p>{'curl -X POST http://host/api/purchase-requests \\'}</p>
            <p>{'  -H "Content-Type: application/json" \\'}</p>
            <p>{'  -H "X-Actor: agent:user123" \\'}</p>
            <p>{'  -H "X-Role: requester" \\'}</p>
            <p>{'  -d \'{"reason":"产线急需M3螺栓500个","lines":[{"requirementText":"M3螺栓","quantity":500}]}\''}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function QuickAction({
  title,
  href,
  icon,
}: {
  title: string;
  href: string;
  icon: string;
}) {
  return (
    <a
      href={href}
      className="flex flex-col items-center justify-center p-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
    >
      <span className="text-2xl mb-2">{icon}</span>
      <span className="text-sm font-medium text-gray-700">{title}</span>
    </a>
  );
}
