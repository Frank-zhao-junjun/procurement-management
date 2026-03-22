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
      <Card>
        <CardHeader>
          <CardTitle>Agent 使用指引</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <span className="bg-blue-100 text-blue-600 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
              <div>
                <p className="font-medium">设置身份</p>
                <p className="text-gray-500">在请求头中设置 X-Actor（身份标识）和 X-Role（角色：requester/manager/buyer）</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="bg-blue-100 text-blue-600 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
              <div>
                <p className="font-medium">采购申请流程</p>
                <p className="text-gray-500">创建采购申请 → 提交申请 → Manager 审批 → 生成采购订单</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="bg-blue-100 text-blue-600 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
              <div>
                <p className="font-medium">寻源流程（可选）</p>
                <p className="text-gray-500">创建寻源任务 → 录入报价 → 授标 → 生成采购订单</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="bg-blue-100 text-blue-600 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0">4</span>
              <div>
                <p className="font-medium">收货流程</p>
                <p className="text-gray-500">收到货物后创建收货单，系统自动计算净收货数量和未收货数量</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="bg-blue-100 text-blue-600 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0">5</span>
              <div>
                <p className="font-medium">审计追踪</p>
                <p className="text-gray-500">所有操作自动记录审计日志，可在审计日志页面查看</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="bg-blue-100 text-blue-600 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0">6</span>
              <div>
                <p className="font-medium">框架协议</p>
                <p className="text-gray-500">采购员可创建框架协议，系统自动匹配已批准的采购申请行项目</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="bg-blue-100 text-blue-600 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0">7</span>
              <div>
                <p className="font-medium">飞书集成（待实现）</p>
                <p className="text-gray-500">支持飞书三应用（需求人/Manager/采购员）集成，HTTPS 发消息 + WebSocket 长连接</p>
              </div>
            </div>
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
