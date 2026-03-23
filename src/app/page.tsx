'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { purchaseRequestsApi, purchaseOrdersApi, suppliersApi, materialsApi } from '@/lib/api';

interface DashboardStats {
  totalPRs: number;
  pendingPRs: number;
  totalPOs: number;
  pendingPOs: number;
  totalSuppliers: number;
  totalMaterials: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalPRs: 0,
    pendingPRs: 0,
    totalPOs: 0,
    pendingPOs: 0,
    totalSuppliers: 0,
    totalMaterials: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        // 并行获取所有统计数据
        const [prData, poData, supplierData, materialData] = await Promise.all([
          purchaseRequestsApi.list({ pageSize: 1 }),
          purchaseOrdersApi.list({ pageSize: 1 }),
          suppliersApi.list({ pageSize: 1 }),
          materialsApi.list({ pageSize: 1 }),
        ]);

        // 获取待审批 PR 数量
        const pendingPRData = await purchaseRequestsApi.list({ 
          pageSize: 1, 
          status: 'submitted' 
        });

        // 获取待发货 PO 数量（已发送状态）
        const pendingPOData = await purchaseOrdersApi.list({ 
          pageSize: 1, 
          status: 'sent' 
        });

        setStats({
          totalPRs: prData.total || 0,
          pendingPRs: pendingPRData.total || 0,
          totalPOs: poData.total || 0,
          pendingPOs: pendingPOData.total || 0,
          totalSuppliers: supplierData.total || 0,
          totalMaterials: materialData.total || 0,
        });
      } catch (error) {
        console.error('Failed to fetch dashboard stats:', error);
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
        <h1 className="text-2xl font-bold text-gray-900">采购管理系统</h1>
        <p className="text-gray-500 mt-1">Procurement Management System</p>
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
            <Link href="/purchase-requests/new">
              <Button variant="outline" className="w-full h-20 flex flex-col gap-1">
                <span className="text-lg">+</span>
                <span className="text-sm">新建采购申请</span>
              </Button>
            </Link>
            <Link href="/purchase-orders">
              <Button variant="outline" className="w-full h-20 flex flex-col gap-1">
                <span className="text-lg">📋</span>
                <span className="text-sm">采购订单</span>
              </Button>
            </Link>
            <Link href="/suppliers">
              <Button variant="outline" className="w-full h-20 flex flex-col gap-1">
                <span className="text-lg">🏢</span>
                <span className="text-sm">供应商</span>
              </Button>
            </Link>
            <Link href="/materials">
              <Button variant="outline" className="w-full h-20 flex flex-col gap-1">
                <span className="text-lg">📦</span>
                <span className="text-sm">物料</span>
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Agent 指引 */}
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-blue-800 flex items-center gap-2">
            Agent 使用完整指引
          </CardTitle>
          <p className="text-xs text-blue-600 mt-1">共 9 条核心指引，覆盖身份、全流程、飞书绑定</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 text-sm">
            <div className="flex items-start gap-3 p-3 bg-white rounded-lg shadow-sm">
              <span className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
              <div>
                <p className="font-semibold text-gray-900">Agent-first 身份识别</p>
                <p className="text-gray-600 mt-1">注册 Agent 后只需传 <code className="bg-gray-100 px-1 rounded">X-Actor: agent_id</code>，系统自动从 <code className="bg-gray-100 px-1 rounded">agent_bindings</code> 表解析角色。</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-white rounded-lg shadow-sm">
              <span className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
              <div>
                <p className="font-semibold text-gray-900">角色权限</p>
                <p className="text-gray-600 mt-1">requester 可创建 PR；buyer 可创建 PO/报价/寻源；manager 可审批 PR 和超收收货。</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-white rounded-lg shadow-sm">
              <span className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
              <div>
                <p className="font-semibold text-gray-900">Agent 注册</p>
                <p className="text-gray-600 mt-1"><code className="bg-gray-100 px-1 rounded">POST /api/agent-bindings</code> 传入 <code className="bg-gray-100 px-1 rounded">agentId</code> 和 <code className="bg-gray-100 px-1 rounded">role</code>。</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-white rounded-lg shadow-sm">
              <span className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0">4</span>
              <div>
                <p className="font-semibold text-gray-900">采购申请流程</p>
                <p className="text-gray-600 mt-1">创建 PR → 提交 → Manager 审批 → 自动匹配 FA → 用户确认。</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-white rounded-lg shadow-sm">
              <span className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0">5</span>
              <div>
                <p className="font-semibold text-gray-900">超收审批</p>
                <p className="text-gray-600 mt-1">收货超过订单 5% 且非 Manager 时需审批，调用 <code className="bg-gray-100 px-1 rounded">POST /api/goods-receipts/[id]/approve-overdelivery</code>。</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-white rounded-lg shadow-sm">
              <span className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0">6</span>
              <div>
                <p className="font-semibold text-gray-900">飞书绑定</p>
                <p className="text-gray-600 mt-1">一个飞书账号绑定一个 Agent，实现一对一隔离。</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-white rounded-lg shadow-sm">
              <span className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0">7</span>
              <div>
                <p className="font-semibold text-gray-900">审计日志</p>
                <p className="text-gray-600 mt-1">所有关键操作自动记录，Manager 可查看全部，其他人只能看自己的。</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-white rounded-lg shadow-sm">
              <span className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0">8</span>
              <div>
                <p className="font-semibold text-gray-900">编号规则</p>
                <p className="text-gray-600 mt-1">Asia/Shanghai 时区，日流水号 01-99。PR-/SC-/FA-/PO-/GR- 前缀。</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-white rounded-lg shadow-sm">
              <span className="bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold flex-shrink-0">9</span>
              <div>
                <p className="font-semibold text-gray-900">Agent 调用示例</p>
                <p className="text-gray-600 mt-1">
                  <code className="bg-gray-100 px-1 rounded">curl -H "X-Actor: my-agent" -X POST /api/purchase-requests</code>
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
