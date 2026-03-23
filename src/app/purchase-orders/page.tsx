'use client';

import { useEffect, useState, useCallback } from 'react';
import { purchaseOrdersApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus } from 'lucide-react';
import { useIdentityChange } from '@/hooks/use-identity-change';

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: '草稿', variant: 'secondary' },
  sent: { label: '已发送', variant: 'outline' },
  partial: { label: '部分收货', variant: 'outline' },
  received: { label: '已收货', variant: 'default' },
  cancelled: { label: '已取消', variant: 'destructive' },
};

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      const data = await purchaseOrdersApi.list({
        page,
        pageSize,
      });
      setOrders(data.data || []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // 监听身份变化，自动刷新
  useIdentityChange(fetchOrders);

  const totalPages = Math.ceil(total / pageSize);

  const handleUpdateStatus = async (id: number, newStatus: string) => {
    try {
      await purchaseOrdersApi.updateStatus?.(id, newStatus);
      fetchOrders();
    } catch (error) {
      alert('更新状态失败');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">采购订单</h1>
          <p className="text-gray-500 mt-1">管理采购订单</p>
        </div>
        <Button asChild>
          <a href="/purchase-orders/new">
            <Plus className="w-4 h-4 mr-2" />
            新建采购订单
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>采购订单列表</CardTitle>
            <div className="flex gap-2">
              <Button
                variant={statusFilter === '' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('')}
              >
                全部
              </Button>
              <Button
                variant={statusFilter === 'draft' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('draft')}
              >
                草稿
              </Button>
              <Button
                variant={statusFilter === 'sent' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('sent')}
              >
                已发送
              </Button>
              <Button
                variant={statusFilter === 'partial' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('partial')}
              >
                部分收货
              </Button>
              <Button
                variant={statusFilter === 'received' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('received')}
              >
                已收货
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : orders.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              暂无采购订单
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>订单号</TableHead>
                    <TableHead>供应商</TableHead>
                    <TableHead>到货日期</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>行数</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.po_number}</TableCell>
                      <TableCell>{order.supplier_snapshot || '-'}</TableCell>
                      <TableCell>
                        {order.delivery_date || '-'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusMap[order.status]?.variant || 'secondary'}>
                          {statusMap[order.status]?.label || order.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{order.purchase_order_lines?.length || 0}</TableCell>
                      <TableCell>
                        {order.created_at ? new Date(order.created_at).toLocaleString('zh-CN') : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="sm" asChild>
                            <a href={`/purchase-orders/${order.id}`}>
                              查看
                            </a>
                          </Button>
                          {order.status === 'draft' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleUpdateStatus(order.id, 'sent')}
                            >
                              标记已发送
                            </Button>
                          )}
                          {order.status === 'sent' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleUpdateStatus(order.id, 'partial')}
                            >
                              部分收货
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-gray-500">
                    共 {total} 条记录，第 {page}/{totalPages} 页
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
