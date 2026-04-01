'use client';

import { useEffect, useState, useCallback } from 'react';
import { goodsReceiptsApi, purchaseOrdersApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus } from 'lucide-react';
import { useIdentityChange } from '@/hooks/use-identity-change';

const typeMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  in: { label: '收货', variant: 'default' },
  out: { label: '退货', variant: 'destructive' },
};

export default function GoodsReceiptsPage() {
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  // 新建收货相关
  const [showNewForm, setShowNewForm] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [newReceipt, setNewReceipt] = useState({
    poLineId: '',
    quantity: '',
    receiptDate: new Date().toISOString().slice(0, 10),
    notes: '',
  });

  const fetchReceipts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await goodsReceiptsApi.list({
        grType: typeFilter || undefined,
        page,
        pageSize,
      });
      setReceipts(data.data || []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error('Failed to fetch receipts:', error);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, page, pageSize]);

  useEffect(() => {
    fetchReceipts();
  }, [fetchReceipts]);

  // 监听身份变化，自动刷新
  useIdentityChange(fetchReceipts);

  useEffect(() => {
    async function fetchOrders() {
      try {
        const data = await purchaseOrdersApi.list({ status: 'sent', pageSize: 100 });
        setOrders(data.data || []);
      } catch (error) {
        console.error('Failed to fetch orders:', error);
      }
    }

    if (showNewForm) {
      fetchOrders();
    }
  }, [showNewForm]);

  const totalPages = Math.ceil(total / pageSize);

  const handleCreateReceipt = async () => {
    try {
      await goodsReceiptsApi.create({
        poId: selectedOrder?.id,
        poLineId: parseInt(newReceipt.poLineId),
        quantity: parseFloat(newReceipt.quantity),
        receiptDate: newReceipt.receiptDate,
        notes: newReceipt.notes || null,
      });
      
      setShowNewForm(false);
      setNewReceipt({
        poLineId: '',
        quantity: '',
        receiptDate: new Date().toISOString().slice(0, 10),
        notes: '',
      });
      setSelectedOrder(null);
      
      fetchReceipts();
    } catch (error: any) {
      alert(error.message || '创建失败');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">收货管理</h1>
          <p className="text-gray-500 mt-1">管理收货单和退货单（净收货口径）</p>
        </div>
        <Button onClick={() => setShowNewForm(true)}>
          <Plus className="w-4 h-4 mr-2" />
          新建收货单
        </Button>
      </div>

      {/* 新建收货表单 */}
      {showNewForm && (
        <Card>
          <CardHeader>
            <CardTitle>新建收货单</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">采购订单</label>
                <select
                  className="w-full mt-1 px-3 py-2 border rounded"
                  value={selectedOrder?.id || ''}
                  onChange={(e) => {
                    const order = orders.find((o) => o.id === parseInt(e.target.value));
                    setSelectedOrder(order);
                    setNewReceipt((r) => ({ ...r, poLineId: '' }));
                  }}
                >
                  <option value="">请选择采购订单</option>
                  {orders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.po_number} - {order.supplier_snapshot || '未知供应商'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">采购订单行</label>
                <select
                  className="w-full mt-1 px-3 py-2 border rounded"
                  value={newReceipt.poLineId}
                  onChange={(e) => setNewReceipt((r) => ({ ...r, poLineId: e.target.value }))}
                  disabled={!selectedOrder}
                >
                  <option value="">请选择订单行</option>
                  {selectedOrder?.purchase_order_lines?.map((line: any) => (
                    <option key={line.id} value={line.id}>
                      行{line.line_number}: {line.material_snapshot} (未收货: {line.pending_qty})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">收货数量</label>
                <Input
                  type="number"
                  step="0.01"
                  value={newReceipt.quantity}
                  onChange={(e) => setNewReceipt((r) => ({ ...r, quantity: e.target.value }))}
                  placeholder="请输入收货数量"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">收货日期</label>
                <Input
                  type="date"
                  value={newReceipt.receiptDate}
                  onChange={(e) => setNewReceipt((r) => ({ ...r, receiptDate: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div className="col-span-2">
                <label className="text-sm font-medium">备注</label>
                <Input
                  value={newReceipt.notes}
                  onChange={(e) => setNewReceipt((r) => ({ ...r, notes: e.target.value }))}
                  placeholder="可选备注"
                  className="mt-1"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setShowNewForm(false)}>
                取消
              </Button>
              <Button
                onClick={handleCreateReceipt}
                disabled={!selectedOrder || !newReceipt.poLineId || !newReceipt.quantity}
              >
                创建
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>收货单列表</CardTitle>
            <div className="flex gap-2">
              <Button
                variant={typeFilter === '' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTypeFilter('')}
              >
                全部
              </Button>
              <Button
                variant={typeFilter === 'in' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTypeFilter('in')}
              >
                收货
              </Button>
              <Button
                variant={typeFilter === 'out' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTypeFilter('out')}
              >
                退货
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : receipts.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              暂无收货记录
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>收货单号</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>关联订单</TableHead>
                    <TableHead>物料名称</TableHead>
                    <TableHead>数量</TableHead>
                    <TableHead>收货日期</TableHead>
                    <TableHead>收货人</TableHead>
                    <TableHead>创建时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipts.map((receipt) => (
                    <TableRow key={receipt.id}>
                      <TableCell className="font-medium">{receipt.gr_number}</TableCell>
                      <TableCell>
                        <Badge variant={typeMap[receipt.gr_type]?.variant || 'secondary'}>
                          {typeMap[receipt.gr_type]?.label || receipt.gr_type}
                        </Badge>
                      </TableCell>
                      <TableCell>{receipt.purchase_orders?.po_number || receipt.po_id}</TableCell>
                      <TableCell>{receipt.purchase_order_lines?.material_snapshot || '-'}</TableCell>
                      <TableCell>{receipt.quantity}</TableCell>
                      <TableCell>{receipt.receipt_date}</TableCell>
                      <TableCell>{receipt.receiver}</TableCell>
                      <TableCell>
                        {receipt.created_at ? new Date(receipt.created_at).toLocaleString('zh-CN') : '-'}
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
