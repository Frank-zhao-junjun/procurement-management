'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Send, Package, X } from 'lucide-react';
import { getIdentityHeaders } from '@/lib/identity-store';

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: '草稿', variant: 'secondary' },
  sent: { label: '已发送', variant: 'outline' },
  partial: { label: '部分收货', variant: 'outline' },
  received: { label: '已收货', variant: 'default' },
  cancelled: { label: '已取消', variant: 'destructive' },
};

export default function PurchaseOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const poId = params.id as string;
  
  const [po, setPo] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPO() {
      try {
        setLoading(true);
        
        // 获取订单详情
        const poRes = await fetch(`/api/purchase-orders/${poId}`, {
          headers: getIdentityHeaders(),
        });
        const poData = await poRes.json();
        
        if (poData.data) {
          setPo(poData.data);
          setLines(poData.data.lines || []);
        }
      } catch (error) {
        console.error('Failed to fetch PO:', error);
      } finally {
        setLoading(false);
      }
    }

    if (poId) {
      fetchPO();
    }
  }, [poId]);

  const handleUpdateStatus = async (newStatus: string) => {
    try {
      const res = await fetch(`/api/purchase-orders/${poId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getIdentityHeaders(),
        },
        body: JSON.stringify({ status: newStatus }),
      });
      
      if (res.ok) {
        // 刷新数据
        const poRes = await fetch(`/api/purchase-orders/${poId}`, {
          headers: getIdentityHeaders(),
        });
        const poData = await poRes.json();
        if (poData.data) {
          setPo(poData.data);
          setLines(poData.data.lines || []);
        }
      }
    } catch (error) {
      alert('更新状态失败');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!po) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="text-gray-500">采购订单不存在</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 返回按钮 */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回
        </Button>
      </div>

      {/* 订单基本信息 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">采购订单 {po.po_number}</CardTitle>
              <p className="text-gray-500 mt-1">
                创建于 {po.created_at ? new Date(po.created_at).toLocaleString('zh-CN') : '-'}
              </p>
            </div>
            <Badge variant={statusMap[po.status]?.variant || 'secondary'} className="text-sm px-3 py-1">
              {statusMap[po.status]?.label || po.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-sm text-gray-500">供应商</p>
              <p className="text-lg font-medium">{po.supplier_snapshot || '-'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">交货日期</p>
              <p className="text-lg font-medium">{po.delivery_date || '未设置'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">订单总金额</p>
              <p className="text-lg font-medium">
                ¥{lines.reduce((sum, l) => sum + (l.total_price || 0), 0).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">创建人</p>
              <p className="text-lg font-medium">{po.created_by || '-'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 订单行项目 */}
      <Card>
        <CardHeader>
          <CardTitle>订单行项目</CardTitle>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <div className="text-center py-8 text-gray-500">暂无订单行</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>行号</TableHead>
                  <TableHead>物料</TableHead>
                  <TableHead>数量</TableHead>
                  <TableHead>单价</TableHead>
                  <TableHead>金额</TableHead>
                  <TableHead>已收货</TableHead>
                  <TableHead>待收货</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => (
                  <TableRow key={line.id || index}>
                    <TableCell>{line.line_number || index + 1}</TableCell>
                    <TableCell className="font-medium">{line.material_snapshot || '-'}</TableCell>
                    <TableCell>{line.quantity}</TableCell>
                    <TableCell>¥{line.unit_price?.toLocaleString() || 0}</TableCell>
                    <TableCell>¥{line.total_price?.toLocaleString() || 0}</TableCell>
                    <TableCell>{line.received_qty || 0}</TableCell>
                    <TableCell>{line.pending_qty || line.quantity}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{line.status || 'ordered'}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 操作按钮 */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-3">
            {po.status === 'draft' && (
              <Button onClick={() => handleUpdateStatus('sent')}>
                <Send className="w-4 h-4 mr-2" />
                发送订单
              </Button>
            )}
            {po.status === 'sent' && (
              <Button onClick={() => router.push(`/goods-receipts/new?poId=${poId}`)}>
                <Package className="w-4 h-4 mr-2" />
                创建收货单
              </Button>
            )}
            {po.status === 'draft' && (
              <Button variant="outline" onClick={() => handleUpdateStatus('cancelled')}>
                <X className="w-4 h-4 mr-2" />
                取消订单
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
