'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft } from 'lucide-react';
import { getIdentityHeaders } from '@/lib/identity-store';

export default function NewGoodsReceiptPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedPoId = searchParams.get('poId');

  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [orderLines, setOrderLines] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    poLineId: '',
    quantity: '',
    receiptDate: new Date().toISOString().slice(0, 10),
    notes: '',
    grType: 'in',
  });

  // 获取可收货的采购订单
  useEffect(() => {
    async function fetchOrders() {
      try {
        const res = await fetch('/api/purchase-orders?status=sent&pageSize=100', {
          headers: getIdentityHeaders(),
        });
        const data = await res.json();
        setOrders(data.data || []);
        
        // 如果有预选的订单ID
        if (preselectedPoId) {
          const order = data.data?.find((o: any) => o.id === parseInt(preselectedPoId));
          if (order) {
            setSelectedOrder(order);
            fetchOrderLines(order.id);
          }
        }
      } catch (error) {
        console.error('Failed to fetch orders:', error);
      }
    }
    fetchOrders();
  }, [preselectedPoId]);

  // 获取订单行
  const fetchOrderLines = async (poId: number) => {
    try {
      const res = await fetch(`/api/purchase-orders/${poId}`, {
        headers: getIdentityHeaders(),
      });
      const data = await res.json();
      setOrderLines(data.data?.lines || []);
    } catch (error) {
      console.error('Failed to fetch order lines:', error);
    }
  };

  const handleOrderChange = (poId: string) => {
    if (!poId) {
      setSelectedOrder(null);
      setOrderLines([]);
      return;
    }
    
    const order = orders.find(o => o.id === parseInt(poId));
    setSelectedOrder(order);
    setFormData(f => ({ ...f, poLineId: '' }));
    fetchOrderLines(parseInt(poId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.poLineId || !formData.quantity) {
      alert('请选择订单行并填写收货数量');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/goods-receipts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getIdentityHeaders(),
        },
        body: JSON.stringify({
          poId: selectedOrder?.id,
          poLineId: parseInt(formData.poLineId),
          quantity: parseFloat(formData.quantity),
          receiptDate: formData.receiptDate,
          notes: formData.notes || null,
          grType: formData.grType,
        }),
      });

      const result = await response.json();

      if (result.error) {
        alert(result.error);
      } else if (result.warning) {
        alert(result.warning);
        router.push('/goods-receipts');
      } else {
        alert(`收货单创建成功: ${result.data.gr_number}`);
        router.push('/goods-receipts');
      }
    } catch (error: any) {
      alert(error.message || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">新建收货单</h1>
          <p className="text-gray-500 mt-1">从已发送的采购订单创建收货单</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>选择采购订单</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">采购订单 *</label>
                <select
                  className="w-full mt-1 px-3 py-2 border rounded"
                  value={selectedOrder?.id || ''}
                  onChange={(e) => handleOrderChange(e.target.value)}
                  required
                >
                  <option value="">请选择采购订单</option>
                  {orders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.po_number} - {order.supplier_snapshot || '未知供应商'}
                    </option>
                  ))}
                </select>
                {orders.length === 0 && (
                  <p className="text-sm text-gray-500 mt-1">暂无可收货的采购订单</p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium">收货类型</label>
                <select
                  className="w-full mt-1 px-3 py-2 border rounded"
                  value={formData.grType}
                  onChange={(e) => setFormData(f => ({ ...f, grType: e.target.value }))}
                >
                  <option value="in">收货</option>
                  <option value="out">退货</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {selectedOrder && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>订单信息</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <p className="text-sm text-gray-500">供应商</p>
                  <p className="font-medium">{selectedOrder.supplier_snapshot || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">交货日期</p>
                  <p className="font-medium">{selectedOrder.delivery_date || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">状态</p>
                  <Badge>已发送</Badge>
                </div>
              </div>

              {orderLines.length > 0 && (
                <div className="mt-4">
                  <label className="text-sm font-medium">选择订单行 *</label>
                  <div className="mt-2 space-y-2">
                    {orderLines.map((line) => (
                      <div
                        key={line.id}
                        className={`p-3 border rounded cursor-pointer transition-colors ${
                          formData.poLineId === String(line.id)
                            ? 'border-blue-500 bg-blue-50'
                            : 'hover:border-gray-300'
                        }`}
                        onClick={() => setFormData(f => ({ ...f, poLineId: String(line.id) }))}
                      >
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="font-medium">{line.material_snapshot || '未指定物料'}</p>
                            <p className="text-sm text-gray-500">
                              单价: ¥{line.unit_price} | 订单数量: {line.quantity}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm">
                              <span className="text-gray-500">已收货: </span>
                              <span className="font-medium">{line.received_qty || 0}</span>
                            </p>
                            <p className="text-sm">
                              <span className="text-gray-500">待收货: </span>
                              <span className="font-medium text-blue-600">{line.pending_qty || line.quantity}</span>
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {formData.poLineId && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>收货信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">收货数量 *</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.quantity}
                    onChange={(e) => setFormData(f => ({ ...f, quantity: e.target.value }))}
                    placeholder="请输入收货数量"
                    className="mt-1"
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">收货日期</label>
                  <Input
                    type="date"
                    value={formData.receiptDate}
                    onChange={(e) => setFormData(f => ({ ...f, receiptDate: e.target.value }))}
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">备注</label>
                <Input
                  value={formData.notes}
                  onChange={(e) => setFormData(f => ({ ...f, notes: e.target.value }))}
                  placeholder="可选备注"
                  className="mt-1"
                />
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end gap-4 mt-6">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            取消
          </Button>
          <Button
            type="submit"
            disabled={loading || !formData.poLineId || !formData.quantity}
          >
            {loading ? '创建中...' : '创建收货单'}
          </Button>
        </div>
      </form>
    </div>
  );
}
